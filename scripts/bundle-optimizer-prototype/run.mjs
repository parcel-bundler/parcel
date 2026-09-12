import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {defaults, metrics, optimize, prepare, strategies} from './model.mjs';
import {fixtures, generated, profiles} from './graphs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const take = name => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`${name} requires a value`);
  const value = args[i + 1]; args.splice(i, 2); return value;
};
const seeds = Number(take('--seeds') ?? 20);
const outDir = path.resolve(take('--out') ?? path.join(here, 'results'));
const input = take('--input');
const selected = (take('--strategies') ?? strategies.join(',')).split(',');
let config = JSON.parse(take('--config') ?? '{}');
const configPath = take('--config-file');
if (configPath) config = {...JSON.parse(await readFile(configPath, 'utf8')), ...config};
const sweep = !args.includes('--no-sweep');
const help = args.includes('--help');
for (const arg of args) if (arg !== '--no-sweep' && arg !== '--help') throw Error(`Unknown option ${arg}`);
if (help) {
  console.log(`Usage: node scripts/bundle-optimizer-prototype/run.mjs [options]
  --seeds 20                     Seeds per random profile (four profiles)
  --out DIRECTORY                Report directory
  --input FILE                   One graph or an array; replaces built-in suite
  --strategies LIST              Comma-separated strategy names
  --config '{"minSize":15000}'    Override model options
  --config-file FILE             Read JSON configuration
  --no-sweep                     Skip sensitivity experiments

Strategies: ${strategies.join(', ')}
Defaults: ${JSON.stringify(defaults, null, 2)}`);
  process.exit(0);
}
if (!Number.isInteger(seeds) || seeds < 0) throw Error('--seeds must be a nonnegative integer');
for (const s of selected) if (!strategies.includes(s)) throw Error(`Unknown strategy ${s}`);
for (const key of Object.keys(config)) if (!(key in defaults)) throw Error(`Unknown configuration key ${key}`);

const fixed = input ? [].concat(JSON.parse(await readFile(input, 'utf8'))) : fixtures();
const randomGraphs = input ? [] : profiles.flatMap(profile => Array.from({length: seeds}, (_, i) => generated(i + 1, profile)));
const graphs = [...fixed, ...randomGraphs];
const runs = [];
for (const graph of graphs) {
  const {model, bundles} = prepare(graph, config);
  const before = metrics(model, bundles);
  const results = selected.map(strategy => optimize(graph, strategy, config));
  runs.push({id: graph.id, description: graph.description, family: randomGraphs.includes(graph) ? graph.id.replace(/-\d+$/, '') : 'fixture',
    before, results: results.map(r => ({...r, layout: undefined, trace: undefined})),
    ...(fixed.includes(graph) ? {graph, details: results} : {})});
  if (runs.length % 20 === 0) console.log(`Compared ${runs.length}/${graphs.length} graphs`);
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const median = xs => {const sorted = xs.toSorted((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;};
const kb = n => (n / 1000).toFixed(1);
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n');
const compare = (runs, strategy) => runs.flatMap(run => {
  const result = run.results.find(r => r.strategy === strategy);
  const baseline = run.results.find(r => r.strategy === 'smallest-first');
  return result && baseline ? [{result, baseline, run}] : [];
});
const fields = ['coldBytes', 'duplicateBytes', 'transitionBytes', 'changedDownloadBytes', 'groupedChangedDownloadBytes'];

const sweeps = [];
const sessionSweeps = [];
if (sweep && !input) {
  const sweepGraphs = [...fixed.filter(g => g.id !== 'mandatory-floor'), ...profiles.flatMap(p => [generated(101, p), generated(102, p)])];
  const variations = [
    ['default', {}],
    ...[0, 15_000, 60_000].map(minSize => [`min=${minSize}`, {minSize}]),
    ...[10, 15, 40].map(maxRequests => [`requests=${maxRequests}`, {maxRequests}]),
    ['extra=0', {maxExtraBytes: 0}],
    ['extra=5KB/2%', {maxExtraBytes: 5000, maxExtraRatio: 0.02}],
    ['extra=30KB/15%', {maxExtraBytes: 30_000, maxExtraRatio: 0.15}],
    ...[0, 0.25, 4].map(cacheWeight => [`cacheWeight=${cacheWeight}`, {cacheWeight}]),
    ...[0.01, 1].map(dependencyRate => [`dependencyRate=${dependencyRate}`, {dependencyRate}]),
    ...[0, 1].map(duplicateWeight => [`duplicateWeight=${duplicateWeight}`, {duplicateWeight}]),
  ];
  for (const [label, overrides] of variations) {
    const results = sweepGraphs.map(g => ({id: g.id, ...optimize(g, 'hybrid', {...config, ...overrides})}));
    sweeps.push({label, config: {...defaults, ...config, ...overrides},
      results: results.map(({id, metrics, elapsedMs}) => ({id, metrics, elapsedMs}))});
    console.log(`Sensitivity: ${label}`);
  }
  // Paired policies: identical graph, transition matrix, probabilities, and
  // request/edit cost for all three. Only allowed transformations differ.
  const pairedGraphs = [...fixed.filter(g => ['near-overlap', 'large-near-overlap', 'large-overlap-pressure', 'navigation-together', 'navigation-apart', 'budget-chain', 'localized-pressure'].includes(g.id)),
    ...profiles.map(p => generated(101, p))];
  const pairedVariations = [
    ['default', {}],
    ...[0, 5000, 20_000, 50_000].map(requestCost => [`requestCost=${requestCost}`, {requestCost}]),
    ['firstPageLoadPriority=0', {firstPageLoadPriority: 0}],
    ['firstPageLoadPriority=1', {firstPageLoadPriority: 1}],
    ['no extra bytes', {maxExtraBytes: 0}],
    ['minSize=0', {minSize: 0}],
    ['cacheWeight=0', {cacheWeight: 0}],
    ['beyond limits; requestCost=200000', {optimizeBeyondLimits: true}],
    ['beyond limits; requestCost=20000', {optimizeBeyondLimits: true, requestCost: 20_000}],
  ];
  for (const [label, overrides] of pairedVariations) {
    const policies = ['session-cover', 'session-intersection', 'session-union'];
    const results = pairedGraphs.flatMap(g => policies.map(policy => {
      const result = optimize(g, policy, {...config, ...overrides});
      return {id: g.id, strategy: policy, metrics: result.metrics, elapsedMs: result.elapsedMs,
        intersections: result.trace.filter(t => t.action.startsWith('intersect')).length};
    }));
    sessionSweeps.push({label, config: {...defaults, ...config, ...overrides}, results});
    console.log(`Paired session sensitivity: ${label}`);
  }
}

let report = `# Bundle optimizer prototype\n\n`;
report += `Compared ${fixed.length} explicit graphs and ${randomGraphs.length} seeded graphs (${seeds} seeds per family). All sizes below are decimal KB of estimated uncompressed code. No browser timing, minification, or compression is simulated.\n\n`;
report += `Configuration: \`${JSON.stringify({...defaults, ...config})}\`\n\n`;
report += 'Session bytes include the first load and, with probability `1 - firstPageLoadPriority`, one transition. Session cost is equivalent bytes: session downloads + requestCost × session requests + cacheWeight × one-edit downloads + sessionDuplicateWeight × emitted duplication. All layouts, including legacy policies, are evaluated under this same session model. This is a comparison coefficient, not a latency estimate or literal HTTP overhead.\n\n';
report += 'The `session-*` policies share the objective and greedy search rules: cover uses existing hosts; intersection adds overlap outputs while retaining residuals; union allows bounded consumer-set expansion; combined permits both. All keep root-absorption fallbacks. This models the Turbopack-style operation and session objective, not its exact selection heuristics or runtime.\n\n';
report += 'By default all policies stop when the original size/request limits are satisfied. Session policies can optionally continue cost-improving merges with `optimizeBeyondLimits: true`; those sensitivity rows are explicitly separate because they change the stopping policy as well as the objective.\n\n';
report += `## Seeded comparisons\n\nEach graph receives equal weight; routes within a graph use their normalized weights. Relative changes compare means with selective smallest-first duplication. Infeasible cases are reported rather than discarded.\n\n`;
const randomRuns = runs.filter(r => r.family !== 'fixture');
report += table(['Strategy', 'Session KB', 'Session requests', 'Session cost (equiv. KB)', 'Cold requests'], selected.map(strategy => {
  const rows = randomRuns.flatMap(run => run.results.filter(r => r.strategy === strategy));
  return [strategy, kb(mean(rows.map(r => r.metrics.sessionBytes))), mean(rows.map(r => r.metrics.sessionRequests)).toFixed(2),
    kb(mean(rows.map(r => r.metrics.sessionCost))), mean(rows.map(r => r.metrics.expectedRequests)).toFixed(2)];
})) + '\n\n';
report += table(['Strategy', 'Feasible', 'Cold KB', 'Duplicate KB', 'Transition KB', 'One-edit KB', 'Group-edit KB', 'Median ms'], selected.map(strategy => {
  const rows = randomRuns.flatMap(run => run.results.filter(r => r.strategy === strategy));
  return [strategy, `${rows.filter(r => r.metrics.feasible).length}/${rows.length}`,
    ...fields.map(f => kb(mean(rows.map(r => r.metrics[f])))), median(rows.map(r => r.elapsedMs)).toFixed(1)];
})) + '\n\n';
for (const strategy of selected.filter(s => s !== 'smallest-first')) {
  const pairs = compare(randomRuns, strategy);
  if (!pairs.length) continue;
  const changes = fields.map(f => `${f}: ${pct(mean(pairs.map(p => p.result.metrics[f])) / Math.max(mean(pairs.map(p => p.baseline.metrics[f])), 1e-9) - 1)}`);
  report += `- **${strategy}:** ${changes.join('; ')}.\n`;
}
report += '\n## Per-family outcomes\n\n';
report += table(['Family', 'Strategy', 'Cold KB', 'Duplicate KB', 'Transition KB', 'One-edit KB', 'Group-edit KB'], profiles.flatMap(family => selected.map(strategy => {
  const rows = runs.filter(r => r.family === family).flatMap(r => r.results.filter(s => s.strategy === strategy));
  return [family, strategy, ...fields.map(f => kb(mean(rows.map(r => r.metrics[f]))))];
}))) + '\n\n';

report += '## Explicit graphs\n\n';
for (const run of runs.filter(r => r.family === 'fixture')) {
  report += `### ${run.id}\n\n${run.description}\n\nBefore: ${run.before.bundles} bundles, maximum ${run.before.maxRequests} requests, ${run.before.undersized} undersized optional bundles.\n\n`;
  report += table(['Strategy', 'Max requests', 'Small left', 'Cold KB', 'Duplicate KB', 'Transition KB', 'One-edit KB', 'Worst extra KB'], run.results.map(r => [r.strategy,
    r.metrics.maxRequests, r.metrics.undersized, ...['coldBytes', 'duplicateBytes', 'transitionBytes', 'changedDownloadBytes', 'maxExtraBytes'].map(f => kb(r.metrics[f]))])) + '\n\n';
  report += table(['Strategy', 'Session KB', 'Session requests', 'Session cost (equiv. KB)'], run.results.map(r => [r.strategy,
    kb(r.metrics.sessionBytes), r.metrics.sessionRequests.toFixed(2), kb(r.metrics.sessionCost)])) + '\n\n';
  const hybrid = run.details.find(r => r.strategy === 'hybrid');
  const guarded = run.details.find(r => r.strategy === 'hybrid-guarded');
  if (guarded) report += `Guarded hybrid selected **${guarded.selection}** by comparing finished layouts.\n\n`;
  if (hybrid) {
    report += `Hybrid decisions (${hybrid.trace.length}):\n\n`;
    report += hybrid.trace.length ? hybrid.trace.map((t, i) => `${i + 1}. ${t.action}; cold ${kb(t.extraColdBytes)} KB, duplication ${kb(t.extraDuplicateBytes)} KB, one-edit ${kb(t.extraChangedDownloadBytes)} KB; remaining excess requests ${t.requestExcess}, undersized bundles ${t.undersized}.`).join('\n') + '\n\n' : 'No legal improving move.\n\n';
  }
  const intersection = run.details.find(r => r.strategy === 'session-intersection');
  if (intersection) {
    report += `Session intersection decisions (${intersection.trace.length}):\n\n`;
    report += intersection.trace.length ? intersection.trace.map((t, i) => `${i + 1}. ${t.action}; session bytes ${kb(t.extraSessionBytes)} KB, session requests ${t.extraSessionRequests.toFixed(3)}; remaining excess requests ${t.requestExcess}, undersized bundles ${t.undersized}.`).join('\n') + '\n\n' : 'No legal improving move.\n\n';
  }
}

report += `## Legacy sensitivity\n\nHybrid only; the same ${sweeps[0]?.results.length ?? 0} graphs for each row, including eight held-out generated graphs (seeds 101–102) when enabled. One option varies at a time around the supplied configuration. These are absolute outcomes, not matched baseline comparisons. The source/dependency rate rows change the one-edit evaluation distribution as well as the decisions, so their cache values are not directly comparable across those rows.\n\n`;
report += table(['Configuration', 'Feasible', 'Mean max requests', 'Cold KB', 'Duplicate KB', 'Transition KB', 'One-edit KB', 'Group-edit KB', 'Worst extra KB'], sweeps.map(s => [s.label,
  `${s.results.filter(r => r.metrics.feasible).length}/${s.results.length}`, mean(s.results.map(r => r.metrics.maxRequests)).toFixed(1),
  ...fields.map(f => kb(mean(s.results.map(r => r.metrics[f])))), kb(Math.max(...s.results.map(r => r.metrics.maxExtraBytes))) ])) + '\n\n';

report += `## Paired session sensitivity\n\nEach setting compares three policies on the same ${sessionSweeps[0] ? sessionSweeps[0].results.length / 3 : 0} graphs. Navigation matrices and all cost coefficients are identical within a setting. Request-cost and first-load-priority rows change the objective itself, so compare policies within a row group rather than costs across settings. This subset includes the two matching-content navigation scenarios and larger chunks.\n\n`;
report += table(['Setting', 'Policy', 'Feasible', 'Session KB', 'Session requests', 'Session cost (equiv. KB)', 'Duplicate KB', 'One-edit KB', 'Intersection moves'], sessionSweeps.flatMap(s =>
  ['session-cover', 'session-intersection', 'session-union'].map(policy => {
    const rows = s.results.filter(r => r.strategy === policy);
    return [s.label, policy, `${rows.filter(r => r.metrics.feasible).length}/${rows.length}`,
      kb(mean(rows.map(r => r.metrics.sessionBytes))), mean(rows.map(r => r.metrics.sessionRequests)).toFixed(2),
      kb(mean(rows.map(r => r.metrics.sessionCost))), kb(mean(rows.map(r => r.metrics.duplicateBytes))),
      kb(mean(rows.map(r => r.metrics.changedDownloadBytes))), rows.reduce((n, r) => n + r.intersections, 0)];
  }))) + '\n\n';

report += '## Regressions versus selective smallest-first\n\nThese are deliberately included so average improvements do not hide worse individual graphs. Sorted by extra cold bytes, then route-transition regression.\n\n';
const regressions = compare(randomRuns, 'hybrid').filter(p => p.result.metrics.coldBytes > p.baseline.metrics.coldBytes + 1 || p.result.metrics.transitionBytes > p.baseline.metrics.transitionBytes + 1 || p.result.metrics.groupedChangedDownloadBytes > p.baseline.metrics.groupedChangedDownloadBytes + 1)
  .sort((a, b) => (b.result.metrics.coldBytes - b.baseline.metrics.coldBytes) - (a.result.metrics.coldBytes - a.baseline.metrics.coldBytes) ||
    (b.result.metrics.transitionBytes - b.baseline.metrics.transitionBytes) - (a.result.metrics.transitionBytes - a.baseline.metrics.transitionBytes)).slice(0, 12);
report += table(['Graph', 'Extra cold KB', 'Transition delta KB', 'One-edit delta KB', 'Group-edit delta KB'], regressions.map(p => [p.run.id,
  ...['coldBytes', 'transitionBytes', 'changedDownloadBytes', 'groupedChangedDownloadBytes'].map(f => kb(p.result.metrics[f] - p.baseline.metrics[f]))])) + '\n\n';
report += '## Interpretation limits\n\nThis models a post-placement bundle/context incidence graph. Contexts already represent complete loading closures after availability filtering; transitive dependencies, lazy execution order, CSS application, cycles, packaging, hash cascades, and compression are not modeled. JS entries cannot be deleted or widened to new consumers. Compatibility labels prohibit cross-type merges. The prototype is not a production correctness proof or a latency benchmark.\n\n';
report += 'The cache score assumes exactly one asset is edited, sampled with weight 1 for source and 0.1 for dependency assets by default. The independent group-edit metric changes a whole synthetic group together. Both start with the requested context fully cached and ignore hash cascades. A session samples a first root using its normalized weight, then an optional second root using that first root’s conditional transition row. Without a matrix, the second root is sampled from other roots proportionally to their weights. Navigation bytes enter session-policy scores, but not legacy scores. Group-edit bytes remain evaluation-only. All reuse is by physical bundle identity: no constituent-aware runtime loading is modeled.\n\n';
report += 'All optimizers are greedy. “cover” uses disjoint existing hosts, not exact set cover. Jaccard is an intentionally unbounded union comparator, not a reproduction of Rollup. “smallest-first” models selective duplication without all Parcel v2 details. The footprint penalty uses emitted duplicate bytes, whose scale depends on graph size; sensitivity to this weight is part of the experiment. Timing is one local run per graph, including metric evaluation and invariant validation, not a statistically stable performance benchmark.\n';

await mkdir(outDir, {recursive: true});
await writeFile(path.join(outDir, 'report.md'), report);
await writeFile(path.join(outDir, 'results.json'), JSON.stringify({experimentVersion: 2, config: {...defaults, ...config}, seeds, runs, sweeps, sessionSweeps}, null, 2));
const csvFields = ['bundles', 'maxRequests', 'requestExcess', 'undersized', 'feasible', ...fields, 'maxExtraBytes', 'sessionBytes', 'sessionRequests', 'sessionCost', 'legacyCost'];
const csv = [['graph', 'family', 'strategy', ...csvFields, 'elapsedMs'], ...runs.flatMap(run => run.results.map(r =>
  [run.id, run.family, r.strategy, ...csvFields.map(f => r.metrics[f]), r.elapsedMs]))];
await writeFile(path.join(outDir, 'summary.csv'), csv.map(row => row.join(',')).join('\n') + '\n');
await writeFile(path.join(outDir, 'example-graph.json'), JSON.stringify(fixed[0] ?? generated(1), null, 2));
console.log(`\nReport: ${path.join(outDir, 'report.md')}`);
console.log(`JSON:   ${path.join(outDir, 'results.json')}`);
console.log(`CSV:    ${path.join(outDir, 'summary.csv')}`);
