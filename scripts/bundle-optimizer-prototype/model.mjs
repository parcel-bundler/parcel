// Deliberately simple post-placement model. No Parcel imports or dependencies.
export const defaults = Object.freeze({
  minSize: 30_000,
  maxRequests: 25,
  maxExtraBytes: 10_000,
  maxExtraRatio: 0.05,
  sourceRate: 1,
  dependencyRate: 0.1,
  duplicateWeight: 0.1,
  cacheWeight: 1,
  firstPageLoadPriority: 0.67,
  requestCost: 200_000,
  sessionDuplicateWeight: 0,
  optimizeBeyondLimits: false,
});

export const strategies = ['all-roots', 'smallest-first', 'cover', 'hybrid', 'hybrid-guarded', 'hybrid-no-cache', 'jaccard',
  'session-cover', 'session-intersection', 'session-union', 'session-combined'];
const sum = (xs, fn = x => x) => xs.reduce((n, x) => n + fn(x), 0);
const subset = (a, b) => a.every(x => b.includes(x));
const intersects = (a, b) => a.some(x => b.includes(x));
const union = (a, b) => [...new Set([...a, ...b])].sort((a, b) => a - b);

export function prepare(graph, options = {}, objective = 'legacy') {
  const config = {...defaults, ...options};
  for (const key of Object.keys(defaults)) {
    if (typeof defaults[key] === 'boolean') {
      if (typeof config[key] !== 'boolean') throw Error(`Invalid ${key}`);
    } else if (!Number.isFinite(config[key]) || config[key] < 0) throw Error(`Invalid ${key}`);
  }
  if (!Number.isInteger(config.maxRequests) || config.maxRequests < 1) throw Error('maxRequests must be a positive integer');
  if (config.firstPageLoadPriority > 1) throw Error('firstPageLoadPriority must be between 0 and 1');
  if (!graph.roots.length || graph.roots.some(r => !Number.isFinite(r.weight ?? 1) || (r.weight ?? 1) < 0)) throw Error('Invalid root weights');
  const totalWeight = sum(graph.roots, r => r.weight ?? 1);
  if (totalWeight <= 0) throw Error('At least one root must have positive weight');
  const weights = graph.roots.map(r => (r.weight ?? 1) / totalWeight);
  // T[r][s] is conditional on the actual first context r. Normalizing all
  // ordered pairs together would distort the first-load distribution when
  // root weights are unequal. Explicit rows are nonnegative relative weights.
  if (graph.transitions && graph.transitions.length !== weights.length) throw Error('Invalid transition matrix size');
  const transitions = weights.map((_, r) => {
    const row = graph.transitions?.[r] ?? weights.map((w, s) => r === s ? 0 : w);
    if (!Array.isArray(row) || row.length !== weights.length || row.some(w => !Number.isFinite(w) || w < 0)) throw Error(`Invalid transition row ${r}`);
    const total = sum(row);
    if (graph.transitions && total === 0) throw Error(`Empty transition row ${r}`);
    return total ? row.map(w => w / total) : weights.map((_, s) => Number(r === s));
  });
  const loadCosts = new Map();
  const rates = graph.assets.map(a => a.source ? config.sourceRate : config.dependencyRate);
  const totalRate = sum(rates);
  const required = graph.roots.map(() => new Set());
  const seenIDs = new Set();
  const bundle = b => {
    const assets = [...new Set(b.assets)].sort((a, b) => a - b);
    const loads = [...new Set(b.loads)].sort((a, b) => a - b);
    for (const a of assets) if (!graph.assets[a]) throw Error(`Missing asset ${a}`);
    for (const r of loads) if (!graph.roots[r]) throw Error(`Missing root ${r}`);
    const size = sum(assets, a => graph.assets[a].size);
    const rate = sum(assets, a => rates[a]);
    const signature = loads.join(',');
    let loading = loadCosts.get(signature);
    if (!loading) {
      const weight = sum(loads, r => weights[r]);
      const transition = weights.reduce((p, w, r) => p + (loads.includes(r) ? 0 : w * sum(loads, s => transitions[r][s])), 0);
      loading = {weight, transition, session: weight + (1 - config.firstPageLoadPriority) * transition};
      loadCosts.set(signature, loading);
    }
    return {...b, assets, loads, size, rate, weight: loading.weight,
      cache: totalRate ? size * rate * loading.weight / totalRate : 0,
      transitionBytes: size * loading.transition, transitionRequests: loading.transition,
      sessionBytes: size * loading.session, sessionRequests: loading.session};
  };
  const bundles = graph.bundles.map(b => {
    if (seenIDs.has(b.id)) throw Error(`Duplicate bundle id ${b.id}`);
    seenIDs.add(b.id);
    for (const r of b.loads) for (const a of b.assets) required[r].add(a);
    return bundle(b);
  });
  const initialBytes = graph.roots.map((_, r) => sum(bundles.filter(b => b.loads.includes(r)), b => b.size));
  const requiredBytes = required.map(as => sum([...as], a => graph.assets[a].size));
  if (initialBytes.some((n, r) => n !== requiredBytes[r])) throw Error('Input must not contain duplicate downloads in a context');
  const model = {graph, config, objective, weights, transitions, rates, required, requiredBytes, initialBytes, bundle,
    uniqueBytes: sum(graph.assets, a => a.size)};
  return {model, bundles};
}

function state(model, bundles) {
  const bytes = model.graph.roots.map(() => 0);
  const requests = bytes.slice();
  let emitted = 0, cache = 0, small = 0, smallOccurrences = 0, sessionBytes = 0, sessionRequests = 0;
  for (const b of bundles) {
    emitted += b.size;
    cache += b.cache;
    sessionBytes += b.sessionBytes;
    sessionRequests += b.sessionRequests;
    if (!b.mandatory && b.size < model.config.minSize) { small++; smallOccurrences += b.loads.length; }
    for (const r of b.loads) { bytes[r] += b.size; requests[r]++; }
  }
  return {bundles, bytes, requests, emitted, cache, small, smallOccurrences, sessionBytes, sessionRequests,
    cold: 0, // weighted below
    excess: sum(requests, n => Math.max(0, n - model.config.maxRequests))};
}

function finish(model, s) {
  s.cold = s.bytes.reduce((n, x, r) => n + x * model.weights[r], 0);
  s.duplicates = s.emitted - model.uniqueBytes;
  s.legacyCost = s.cold + model.config.duplicateWeight * s.duplicates + model.config.cacheWeight * s.cache;
  s.sessionCost = s.sessionBytes + model.config.requestCost * s.sessionRequests +
    model.config.cacheWeight * s.cache + model.config.sessionDuplicateWeight * s.duplicates;
  s.cost = model.objective === 'session' ? s.sessionCost : s.legacyCost;
  return s;
}

// Evaluate only changed bundles. Full copies/validation happen after selection.
function evaluate(model, current, removed, added, label, enforceBudget = true) {
  const bytes = current.bytes.slice(), requests = current.requests.slice();
  let emitted = current.emitted, cache = current.cache, small = current.small;
  let smallOccurrences = current.smallOccurrences, sessionBytes = current.sessionBytes, sessionRequests = current.sessionRequests;
  for (const [bs, sign] of [[removed, -1], [added, 1]]) for (const b of bs) {
    emitted += sign * b.size;
    cache += sign * b.cache;
    sessionBytes += sign * b.sessionBytes;
    sessionRequests += sign * b.sessionRequests;
    small += sign * Number(!b.mandatory && b.size < model.config.minSize);
    smallOccurrences += sign * Number(!b.mandatory && b.size < model.config.minSize) * b.loads.length;
    for (const r of b.loads) { bytes[r] += sign * b.size; requests[r] += sign; }
  }
  if (requests.some((n, r) => n > current.requests[r])) return null;
  if (enforceBudget && bytes.some((n, r) => n - model.initialBytes[r] >
    Math.min(model.config.maxExtraBytes, model.config.maxExtraRatio * model.initialBytes[r]) + 1e-6)) return null;
  const excess = sum(requests, n => Math.max(0, n - model.config.maxRequests));
  const session = model.objective === 'session';
  if (session ? smallOccurrences > current.smallOccurrences : small > current.small) return null;
  const requestReduction = sum(current.requests) - sum(requests);
  if (requestReduction <= 0) return null;
  const relief = current.excess - excess + (session ? current.smallOccurrences - smallOccurrences : current.small - small);
  const next = finish(model, {bytes, requests, emitted, cache, small, smallOccurrences, excess, sessionBytes, sessionRequests});
  // Session policies may make beneficial moves below the hard limits. They can
  // increase file count (intersection + residuals), but total requests strictly
  // decrease, giving a finite bound and leaving mandatory outputs intact.
  if (relief <= 0 && (!session || !model.config.optimizeBeyondLimits || next.cost >= current.cost - 1e-7)) return null;
  return {removed, added, label, next, relief, requestReduction,
    // Among unavoidable regressions prefer lower cost per constraint repaired;
    // among beneficial session moves prefer the largest absolute improvement.
    score: (next.cost - current.cost) / (session && next.cost < current.cost ? 1 : Math.max(relief, 1))};
}

function absorb(model, current, source, hosts, covered, label, enforceBudget = true) {
  if (source.mandatory || !covered.length || !subset(covered, source.loads)) return null;
  if (!hosts.length || hosts.some(h => h.id === source.id || h.compat !== source.compat || !subset(h.loads, covered))) return null;
  if (!covered.every(r => hosts.some(h => h.loads.includes(r)))) return null;
  const remaining = source.loads.filter(r => !covered.includes(r));
  const added = hosts.map(h => model.bundle({...h, assets: union(h.assets, source.assets)}));
  if (remaining.length) added.push(model.bundle({...source, loads: remaining}));
  return evaluate(model, current, [source, ...hosts], added, label, enforceBudget);
}

function rootHosts(current, source, covered) {
  return covered.map(r => current.bundles.find(b => b.mandatory && b.compat === source.compat && b.loads.length === 1 && b.loads[0] === r));
}

function rootAbsorption(model, current, source, covered) {
  const hosts = rootHosts(current, source, covered);
  if (hosts.some(h => !h)) return null;
  return absorb(model, current, source, hosts, covered,
    `copy ${source.id} into roots ${covered.join(',')}${covered.length < source.loads.length ? ' (retain residual)' : ''}`);
}

// Disjoint greedy set cover: selected hosts never add two copies to one context.
// This intentionally gives up overlapping covers to keep the prototype small.
function coverAbsorption(model, current, source, covered) {
  let remaining = covered.slice();
  const hosts = [];
  while (remaining.length) {
    const candidates = current.bundles.filter(h => h.id !== source.id && h.compat === source.compat &&
      h.loads.length && subset(h.loads, remaining));
    candidates.sort((a, b) => {
      const price = h => {
        const enlarged = model.bundle({...h, assets: union(h.assets, source.assets)});
        const added = enlarged.size - h.size;
        if (model.objective === 'session') return ((enlarged.sessionBytes - h.sessionBytes) +
          model.config.sessionDuplicateWeight * added + model.config.cacheWeight * (enlarged.cache - h.cache)) / Math.max(h.weight, 1e-9);
        return (added * h.weight + model.config.duplicateWeight * added +
          model.config.cacheWeight * (enlarged.cache - h.cache)) / Math.max(h.weight, 1e-9);
      };
      return price(a) - price(b) || b.loads.length - a.loads.length || a.id.localeCompare(b.id);
    });
    if (!candidates.length) return null;
    const host = candidates[0];
    hosts.push(host);
    remaining = remaining.filter(r => !host.loads.includes(r));
  }
  return absorb(model, current, source, hosts, covered,
    `cover ${source.id} with ${hosts.map(h => h.id).join(',')}${covered.length < source.loads.length ? ' (retain residual)' : ''}`);
}

function merge(model, current, a, b, budget) {
  if (a.compat !== b.compat || (a.mandatory && b.mandatory)) return null;
  if (a.mandatory) [a, b] = [b, a];
  // Never make another context load an entry facade and execute its entry.
  if (b.mandatory && !subset(a.loads, b.loads)) return null;
  const merged = model.bundle({...b, assets: union(a.assets, b.assets), loads: union(a.loads, b.loads)});
  const candidate = evaluate(model, current, [a, b], [merged], `union ${a.id} into ${b.id}`, budget);
  if (candidate) candidate.similarity = a.loads.filter(r => b.loads.includes(r)).length / union(a.loads, b.loads).length;
  return candidate;
}

function intersectionMerge(model, current, a, b) {
  // Entries retain their exact load set and execution identity. Absorption is
  // the existing route for using them as hosts; never split them into residuals.
  if (a.mandatory || b.mandatory || a.compat !== b.compat) return null;
  const overlap = a.loads.filter(r => b.loads.includes(r));
  if (!overlap.length) return null;
  const aOnly = a.loads.filter(r => !overlap.includes(r));
  const bOnly = b.loads.filter(r => !overlap.includes(r));
  // Stable synthetic identity; avoid depending on how many rejected candidates
  // were evaluated. A serial suffix only resolves a live identity collision.
  const base = `intersection(${[a.id, b.id].sort().join('+')})`;
  let id = base, suffix = 0;
  while (current.bundles.some(b => b.id === id)) id = `${base}-${++suffix}`;
  const added = [model.bundle({id, compat: a.compat, mandatory: false,
    assets: union(a.assets, b.assets), loads: overlap})];
  if (aOnly.length) added.push(model.bundle({...a, loads: aOnly}));
  if (bOnly.length) added.push(model.bundle({...b, loads: bOnly}));
  return evaluate(model, current, [a, b], added,
    `intersect ${a.id} and ${b.id} on ${overlap.join(',')} (residuals ${aOnly.length}/${bOnly.length})`);
}

function baseline(model, current, global) {
  const optional = current.bundles.filter(b => !b.mandatory).sort((a, b) => a.size - b.size || a.id.localeCompare(b.id));
  for (const b of optional.filter(b => b.size < model.config.minSize)) {
    const c = rootAbsorption(model, current, b, b.loads);
    if (c) return c;
  }
  for (let r = 0; r < current.requests.length; r++) {
    if (current.requests[r] <= model.config.maxRequests) continue;
    for (const b of optional.filter(b => b.loads.includes(r))) {
      const c = rootAbsorption(model, current, b, global ? b.loads : [r]);
      if (c) return c;
    }
  }
  return null;
}

function bestCandidate(model, current, strategy) {
  if (strategy === 'all-roots' || strategy === 'smallest-first') return baseline(model, current, strategy === 'all-roots');
  const overloaded = current.requests.flatMap((n, r) => n > model.config.maxRequests ? [r] : []);
  const active = current.bundles.filter(b => !b.mandatory && ((model.objective === 'session' && model.config.optimizeBeyondLimits) || b.size < model.config.minSize || intersects(b.loads, overloaded)));
  let best = null;
  const consider = candidate => {
    if (!candidate) return;
    if (strategy === 'jaccard') {
      candidate.score = -(candidate.similarity ?? -1);
    }
    if (!best || candidate.score < best.score - 1e-8 ||
      (Math.abs(candidate.score - best.score) < 1e-8 && candidate.label < best.label)) best = candidate;
  };
  const pairs = new Set();
  for (const source of active) {
    consider(rootAbsorption(model, current, source, source.loads));
    if (strategy !== 'jaccard') consider(coverAbsorption(model, current, source, source.loads));
    const pressured = source.loads.filter(r => overloaded.includes(r));
    for (const covered of [...pressured.map(r => [r]), ...(pressured.length > 1 ? [pressured] : [])]) {
      consider(rootAbsorption(model, current, source, covered));
      if (strategy !== 'jaccard') consider(coverAbsorption(model, current, source, covered));
    }
    if (strategy === 'cover' || strategy === 'session-cover') continue;
    for (const target of current.bundles) {
      if (target.id === source.id || !intersects(source.loads, target.loads)) continue;
      const key = [source.id, target.id].sort().join('|');
      if (pairs.has(key)) continue;
      pairs.add(key);
      if (strategy === 'session-intersection' || strategy === 'session-combined') {
        consider(intersectionMerge(model, current, source, target));
      }
      if (strategy !== 'session-intersection') consider(merge(model, current, source, target, strategy !== 'jaccard'));
    }
  }
  return best;
}

export function validate(model, bundles) {
  if (new Set(bundles.map(b => b.id)).size !== bundles.length) throw Error('Duplicate physical bundle identity');
  const provided = model.graph.roots.map(() => new Set());
  for (const b of bundles) {
    if (!b.assets.length || !b.loads.length) throw Error(`Empty bundle ${b.id}`);
    for (const a of b.assets) if (model.graph.assets[a].compat !== b.compat) throw Error(`Incompatible asset in ${b.id}`);
    for (const r of b.loads) for (const a of b.assets) provided[r].add(a);
  }
  for (let r = 0; r < provided.length; r++) {
    for (const a of model.required[r]) if (!provided[r].has(a)) throw Error(`Lost asset ${a} in context ${r}`);
  }
  for (const original of model.graph.bundles.filter(b => b.mandatory)) {
    const b = bundles.find(b => b.id === original.id);
    if (!b || !b.mandatory || !subset(b.loads, original.loads) || !subset(original.loads, b.loads) || !subset(original.assets, b.assets)) {
      throw Error(`Changed mandatory boundary ${original.id}`);
    }
  }
  return provided;
}

export function metrics(model, bundles) {
  const s = finish(model, state(model, bundles));
  const provided = validate(model, bundles);
  let overfetch = 0, duplicateDownload = 0;
  for (let r = 0; r < provided.length; r++) {
    const unique = sum([...provided[r]], a => model.graph.assets[a].size);
    overfetch += (unique - model.requiredBytes[r]) * model.weights[r];
    duplicateDownload += (s.bytes[r] - unique) * model.weights[r];
  }
  // Physical-file cache only. Constituent/module-aware loading is deferred.
  const transition = sum(bundles, b => b.transitionBytes);
  const expectedRequests = s.requests.reduce((n, x, r) => n + x * model.weights[r], 0);
  // Independent evaluation: all assets in a synthetic change group change
  // together. Unlike the optimizer's score, group size does not multiply churn.
  const groups = new Map();
  for (let a = 0; a < model.graph.assets.length; a++) {
    const key = model.graph.assets[a].changeGroup ?? model.graph.assets[a].id;
    const group = groups.get(key) ?? {assets: new Set(), rate: 0};
    group.assets.add(a);
    group.rate = Math.max(group.rate, model.rates[a]);
    groups.set(key, group);
  }
  const groupRate = sum([...groups.values()], g => g.rate);
  const groupedChangedDownload = groupRate ? sum([...groups.values()], g =>
    g.rate * sum(bundles.filter(b => b.assets.some(a => g.assets.has(a))), b => b.size * b.weight)) / groupRate : 0;
  return {bundles: bundles.length, maxRequests: Math.max(...s.requests), expectedRequests,
    requestExcess: s.excess, undersized: s.small, feasible: s.excess === 0 && s.small === 0,
    emittedBytes: s.emitted, duplicateBytes: s.duplicates, coldBytes: s.cold,
    overfetchBytes: overfetch, duplicateDownloadBytes: duplicateDownload,
    transitionBytes: transition, transitionRequests: sum(bundles, b => b.transitionRequests),
    sessionBytes: s.sessionBytes, sessionRequests: s.sessionRequests,
    changedDownloadBytes: s.cache, groupedChangedDownloadBytes: groupedChangedDownload, cost: s.cost,
    legacyCost: s.legacyCost, sessionCost: s.sessionCost,
    maxExtraBytes: Math.max(...s.bytes.map((n, r) => n - model.initialBytes[r])),
    roots: s.requests.map((requests, r) => ({name: model.graph.roots[r].id,
      requests, bytes: s.bytes[r], extraBytes: s.bytes[r] - model.initialBytes[r]}))};
}

export function optimize(graph, strategy = 'hybrid', options = {}) {
  if (!strategies.includes(strategy)) throw Error(`Unknown strategy ${strategy}`);
  const start = performance.now();
  if (strategy === 'hybrid-guarded') {
    const alternatives = ['smallest-first', 'cover', 'hybrid'].map(s => optimize(graph, s, options));
    alternatives.sort((a, b) => Number(b.metrics.feasible) - Number(a.metrics.feasible) ||
      (a.metrics.requestExcess + a.metrics.undersized) - (b.metrics.requestExcess + b.metrics.undersized) ||
      a.metrics.cost - b.metrics.cost || a.strategy.localeCompare(b.strategy));
    const selected = alternatives[0];
    return {...selected, strategy, selection: selected.strategy, elapsedMs: performance.now() - start};
  }
  const objective = strategy.startsWith('session-') ? 'session' : 'legacy';
  const {model, bundles} = prepare(graph, strategy === 'hybrid-no-cache' ? {...options, cacheWeight: 0} : options, objective);
  let current = finish(model, state(model, bundles));
  const trace = [];
  const limit = sum(current.requests);
  while ((model.objective === 'session' && model.config.optimizeBeyondLimits) || current.small || current.excess) {
    const candidate = bestCandidate(model, current, strategy);
    if (!candidate) break;
    const removed = new Set(candidate.removed.map(b => b.id));
    const nextBundles = [...current.bundles.filter(b => !removed.has(b.id)), ...candidate.added].sort((a, b) => a.id.localeCompare(b.id));
    trace.push({action: candidate.label, score: candidate.score, relief: candidate.relief, requestReduction: candidate.requestReduction,
      extraSessionBytes: candidate.next.sessionBytes - current.sessionBytes,
      extraSessionRequests: candidate.next.sessionRequests - current.sessionRequests,
      extraColdBytes: candidate.next.cold - current.cold,
      extraDuplicateBytes: candidate.next.duplicates - current.duplicates,
      extraChangedDownloadBytes: candidate.next.cache - current.cache,
      requestExcess: candidate.next.excess, undersized: candidate.next.small});
    current = {...candidate.next, bundles: nextBundles};
    validate(model, nextBundles);
    if (trace.length > limit) throw Error('Optimizer failed to make monotonic progress');
  }
  // Report every strategy using the same configured cache metric, including the
  // no-cache ablation (only its decisions ignore the cache penalty).
  const reportModel = prepare(graph, options, objective).model;
  const reportBundles = current.bundles.map(b => reportModel.bundle(b));
  return {strategy, objective, config: reportModel.config, metrics: metrics(reportModel, reportBundles),
    elapsedMs: performance.now() - start, trace,
    layout: reportBundles.map(({id, assets, loads, mandatory, compat}) => ({id, assets, loads, mandatory, compat}))};
}
