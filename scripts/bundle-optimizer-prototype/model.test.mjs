import assert from 'node:assert/strict';
import test from 'node:test';
import {defaults, metrics, optimize, prepare, strategies} from './model.mjs';
import {builder, fixtures, generated, profiles} from './graphs.mjs';

const cases = fixtures();
const fixture = id => cases.find(g => g.id === id);

test('subset cover retains two copies instead of four, without extra downloads', () => {
  const baseline = optimize(fixture('subset-cover'), 'smallest-first');
  const cover = optimize(fixture('subset-cover'), 'cover');
  assert.equal(baseline.metrics.duplicateBytes, 30_000);
  assert.equal(cover.metrics.duplicateBytes, 10_000);
  assert.equal(cover.metrics.overfetchBytes, 0);
  assert.ok(cover.metrics.feasible);
});

test('near-overlap union meets minimum with bounded over-fetch', () => {
  const out = optimize(fixture('near-overlap'));
  assert.ok(out.metrics.feasible);
  assert.ok(out.trace.some(t => t.action.startsWith('union')));
  assert.ok(out.metrics.maxExtraBytes <= 6000);
});

test('high Jaccard similarity cannot override cumulative byte guards', () => {
  const graph = fixture('size-trap');
  const safe = optimize(graph), unsafe = optimize(graph, 'jaccard');
  assert.ok(safe.metrics.maxExtraBytes <= defaults.maxExtraBytes);
  assert.equal(unsafe.metrics.maxExtraBytes, 500_000);
});

test('one-edit cache metric agrees with explicit enumeration including copies', () => {
  const graph = fixture('subset-cover');
  const {model} = prepare(graph);
  const layout = optimize(graph, 'cover').layout.map(model.bundle);
  const totalRate = model.rates.reduce((a, b) => a + b, 0);
  let expected = 0;
  for (let a = 0; a < graph.assets.length; a++) for (let r = 0; r < graph.roots.length; r++) {
    const downloaded = layout.filter(b => b.loads.includes(r) && b.assets.includes(a)).reduce((n, b) => n + b.size, 0);
    expected += model.rates[a] / totalRate * model.weights[r] * downloaded;
  }
  assert.ok(Math.abs(metrics(model, layout).changedDownloadBytes - expected) < 1e-7);
});

test('source churn penalty changes hot-helper decision', () => {
  const graph = fixture('hot-helper');
  const cached = optimize(graph), uncached = optimize(graph, 'hybrid-no-cache');
  assert.ok(cached.metrics.changedDownloadBytes < uncached.metrics.changedDownloadBytes);
  assert.ok(uncached.trace.some(t => t.action.startsWith('union')));
});

test('request pressure can retain a shared bundle for unaffected routes', () => {
  const graph = fixture('localized-pressure');
  const local = optimize(graph, 'smallest-first');
  const global = optimize(graph, 'all-roots');
  assert.ok(local.metrics.feasible);
  assert.ok(local.trace.some(t => t.action.includes('retain residual')));
  assert.ok(local.metrics.duplicateBytes < global.metrics.duplicateBytes);
});

test('mandatory request floor terminates and is explicitly infeasible', () => {
  for (const strategy of strategies) {
    const out = optimize(fixture('mandatory-floor'), strategy);
    assert.equal(out.metrics.maxRequests, 28);
    assert.equal(out.metrics.requestExcess, 3);
    assert.equal(out.metrics.feasible, false);
    assert.equal(out.trace.length, 0);
  }
});

test('cache-disabled ablation reports the same evaluation metric as other strategies', () => {
  const graph = fixture('hot-helper');
  const out = optimize(graph, 'hybrid-no-cache');
  const {model} = prepare(graph);
  assert.equal(out.metrics.changedDownloadBytes, metrics(model, out.layout.map(model.bundle)).changedDownloadBytes);
});

test('seeded graphs preserve assets, boundaries, requests, byte budgets, and determinism', () => {
  for (const profile of profiles) for (let seed = 1; seed <= 3; seed++) {
    const graph = generated(seed, profile);
    const {model, bundles} = prepare(graph);
    const before = metrics(model, bundles);
    for (const strategy of strategies) {
      const out = optimize(graph, strategy);
      assert.ok(out.metrics.feasible, `${profile}/${seed}/${strategy}`);
      if (strategy === 'session-cover' || strategy === 'session-intersection') assert.equal(out.metrics.maxExtraBytes, 0);
      for (let r = 0; r < graph.roots.length; r++) {
        assert.ok(out.metrics.roots[r].requests <= before.roots[r].requests);
        if (strategy !== 'jaccard') assert.ok(out.metrics.roots[r].extraBytes <=
          Math.min(defaults.maxExtraBytes, defaults.maxExtraRatio * model.initialBytes[r]) + 1e-6);
      }
      assert.deepEqual(out.layout, optimize(graph, strategy).layout);
    }
  }
});

test('zero over-fetch budget and configurable thresholds are honored', () => {
  const out = optimize(fixture('budget-chain'), 'hybrid', {maxExtraBytes: 0, minSize: 15_000, maxRequests: 3});
  assert.ok(out.metrics.feasible);
  assert.equal(out.metrics.maxExtraBytes, 0);
});

test('guarded hybrid avoids the minimum-size/budget greedy trap', () => {
  const graph = fixture('budget-chain');
  const greedy = optimize(graph), baseline = optimize(graph, 'smallest-first');
  // Preserve this counterexample; the unguarded algorithm is intentionally
  // retained as an experimental comparator rather than hiding its regression.
  assert.ok(greedy.metrics.coldBytes > baseline.metrics.coldBytes);
  assert.ok(greedy.metrics.duplicateBytes > baseline.metrics.duplicateBytes);
  const guarded = optimize(graph, 'hybrid-guarded');
  assert.ok(guarded.metrics.cost <= baseline.metrics.cost);
  assert.equal(guarded.metrics.maxExtraBytes, 0);
  assert.ok(guarded.selection !== 'hybrid');
});

test('nonuniform context weights affect reported cold bytes', () => {
  const {graph, add} = builder('weighted', 2, '', 10_000);
  graph.roots[0].weight = 9;
  add('unique', 20_000, [0]);
  const {model, bundles} = prepare(graph);
  assert.equal(metrics(model, bundles).coldBytes, 28_000);
});

test('intersection emits a shared overlap plus both exact residuals', () => {
  const graph = fixture('navigation-together');
  const out = optimize(graph, 'session-intersection', {requestCost: 20_000, optimizeBeyondLimits: true});
  assert.ok(out.trace.some(t => t.action.startsWith('intersect')));
  assert.deepEqual(out.layout.find(b => b.id === 'A').loads, [0, 1]);
  assert.deepEqual(out.layout.find(b => b.id === 'B').loads, [2, 3]);
  const merged = out.layout.find(b => b.id.startsWith('intersection('));
  assert.deepEqual(merged.loads, [4, 5]);
  assert.deepEqual(merged.assets, [...new Set(graph.bundles.filter(b => !b.mandatory).flatMap(b => b.assets))].sort((a, b) => a - b));
  assert.equal(out.layout.length, graph.bundles.length + 1);
  assert.equal(out.metrics.maxExtraBytes, 0);
  assert.ok(out.metrics.feasible);
});

test('intersection can temporarily increase undersized file count while reducing requests', () => {
  const {graph, add} = builder('small-residuals', 6, '');
  add('A', 10_000, [0, 1, 4, 5]); add('B', 10_000, [2, 3, 4, 5]);
  const out = optimize(graph, 'session-intersection', {requestCost: 0, firstPageLoadPriority: 1});
  assert.ok(out.trace[0].action.startsWith('intersect'));
  assert.equal(out.trace[0].undersized, 3);
  assert.ok(out.trace.every(t => t.requestReduction > 0));
  assert.ok(out.metrics.feasible);
  assert.equal(out.metrics.maxExtraBytes, 0);
});

test('transition pattern alone changes the chosen layout under a common objective', () => {
  const together = optimize(fixture('navigation-together'), 'session-intersection', {requestCost: 20_000, optimizeBeyondLimits: true});
  const apart = optimize(fixture('navigation-apart'), 'session-intersection', {requestCost: 20_000, optimizeBeyondLimits: true});
  assert.ok(together.trace.some(t => t.action.startsWith('intersect')));
  assert.ok(apart.trace.every(t => !t.action.startsWith('intersect')));
  assert.equal(together.metrics.coldBytes, apart.metrics.coldBytes);
});

// Independent session replay. This does not use the per-bundle closed form.
function replay(model, layout) {
  let bytes = 0, requests = 0;
  const firstOnly = model.config.firstPageLoadPriority;
  for (let r = 0; r < model.graph.roots.length; r++) {
    const loaded = layout.filter(b => b.loads.includes(r));
    const cached = new Set(loaded.map(b => b.id));
    const firstBytes = loaded.reduce((n, b) => n + b.size, 0);
    bytes += model.weights[r] * firstOnly * firstBytes;
    requests += model.weights[r] * firstOnly * loaded.length;
    for (let t = 0; t < model.graph.roots.length; t++) {
      const missing = layout.filter(b => b.loads.includes(t) && !cached.has(b.id));
      const p = model.weights[r] * (1 - firstOnly) * model.transitions[r][t];
      bytes += p * (firstBytes + missing.reduce((n, b) => n + b.size, 0));
      requests += p * (loaded.length + missing.length);
    }
  }
  return {bytes, requests};
}

test('session metrics match brute-force physical-cache replay with weighted roots', () => {
  const graph = structuredClone(fixture('navigation-together'));
  graph.roots.forEach((r, i) => r.weight = i + 1);
  for (const explicit of [false, true]) for (const firstPageLoadPriority of [0, 0.67, 1]) {
    const input = structuredClone(graph);
    if (!explicit) delete input.transitions;
    const config = {firstPageLoadPriority, requestCost: 20_000, optimizeBeyondLimits: true};
    const out = optimize(input, 'session-intersection', config);
    const {model} = prepare(input, config, 'session');
    const expected = replay(model, out.layout.map(model.bundle));
    assert.ok(Math.abs(out.metrics.sessionBytes - expected.bytes) < 1e-6);
    assert.ok(Math.abs(out.metrics.sessionRequests - expected.requests) < 1e-9);
    assert.ok(Math.abs(out.metrics.sessionCost - (expected.bytes + config.requestCost * expected.requests + out.metrics.changedDownloadBytes)) < 1e-6);
  }
});

test('a different bundle containing an already-loaded asset is downloaded in full', () => {
  const {graph, add} = builder('physical-cache', 2, '', 10_000);
  add('A', 5000, [0, 1]);
  const {model, bundles} = prepare(graph, {firstPageLoadPriority: 0});
  const a = bundles.find(b => b.id === 'A');
  const layout = bundles.filter(b => b.id !== 'A').map(b => model.bundle({...b, assets: [...b.assets, ...a.assets]}));
  // Both routes contain A, but have distinct physical output identities.
  assert.equal(metrics(model, layout).transitionBytes, 15_000);
  assert.equal(metrics(model, layout).sessionBytes, 30_000);
});

test('session policies can improve the objective below both hard limits', () => {
  const graph = fixture('navigation-together');
  const before = prepare(graph, {requestCost: 20_000, maxRequests: 30}, 'session');
  const original = metrics(before.model, before.bundles);
  assert.equal(optimize(graph, 'session-intersection', {requestCost: 20_000, maxRequests: 30}).trace.length, 0);
  const after = optimize(graph, 'session-intersection', {requestCost: 20_000, maxRequests: 30, optimizeBeyondLimits: true});
  assert.ok(original.feasible);
  assert.ok(after.metrics.sessionCost < original.sessionCost);
  assert.ok(after.trace.every(t => t.relief === 0 && t.score < 0));
});

test('singleton sessions and invalid transition/configuration inputs', () => {
  const {graph} = builder('singleton', 1, '', 10_000);
  const {model, bundles} = prepare(graph, {firstPageLoadPriority: 0});
  assert.equal(metrics(model, bundles).sessionBytes, 10_000);
  assert.equal(metrics(model, bundles).sessionRequests, 1);
  assert.throws(() => prepare(graph, {firstPageLoadPriority: 1.1}), /firstPageLoadPriority/);
  assert.throws(() => prepare(graph, {optimizeBeyondLimits: 1}), /optimizeBeyondLimits/);
  assert.throws(() => prepare({...graph, transitions: [[-1]]}), /transition/);
  assert.throws(() => prepare({...graph, transitions: [[0]]}), /transition/);
  assert.throws(() => prepare({...graph, transitions: [[1, 1]]}), /transition/);
});
