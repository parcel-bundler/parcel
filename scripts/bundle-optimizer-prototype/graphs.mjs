export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function builder(id, count, description, entrySize = 120_000) {
  const graph = {id, description, roots: Array.from({length: count}, (_, i) => ({id: `route-${i}`, weight: 1})), assets: [], bundles: []};
  const signatures = new Map();
  const add = (name, size, loads, source = false, modules = Math.max(1, Math.ceil(size / 5000)), compat = 'js', mandatory = false) => {
    const assets = [];
    for (let i = 0; i < modules; i++) {
      assets.push(graph.assets.length);
      graph.assets.push({id: `${name}/${i}`, size: Math.floor(size / modules) + Number(i < size % modules), source, compat, changeGroup: name});
    }
    loads = [...new Set(loads)].sort((a, b) => a - b);
    const signature = `${compat}:${loads.join(',')}`;
    const existing = signatures.get(signature);
    if (!mandatory && existing) existing.assets.push(...assets);
    else {
      const b = {id: name, assets, loads, mandatory, compat};
      graph.bundles.push(b);
      if (!mandatory || compat === 'js') signatures.set(signature, b);
    }
  };
  for (let r = 0; r < count; r++) add(`entry-${r}`, entrySize, [r], true, 12, 'js', true);
  return {graph, add, roots: Array.from({length: count}, (_, r) => r)};
}

export function fixtures() {
  const result = [];
  {
    const {graph, add, roots} = builder('subset-cover', 4, 'Two existing shared hosts cover the consumers of a small common bundle.');
    add('left', 40_000, [0, 1]); add('right', 40_000, [2, 3]); add('common', 10_000, roots);
    result.push(graph);
  }
  {
    const {graph, add, roots} = builder('near-overlap', 8, 'Five 6 KB bundles each omit a different route; a 30 KB union needs only 6 KB of over-fetching on each affected route.');
    for (let i = 0; i < 5; i++) add(`shared-${i}`, 6000, roots.filter(r => r !== i));
    result.push(graph);
  }
  {
    const {graph, add, roots} = builder('size-trap', 20, 'A 5 KB and 500 KB bundle have 90% Jaccard similarity, but their union adds 500 KB to one route.');
    add('tiny', 5000, roots.slice(0, -1)); add('huge', 500_000, roots.slice(1));
    result.push(graph);
  }
  {
    const {graph, add, roots} = builder('hot-helper', 8, 'A 2 KB application helper is almost co-loaded with 500 KB of dependencies.');
    add('helper', 2000, roots.slice(0, -1), true, 1); add('vendor', 500_000, roots);
    result.push(graph);
  }
  {
    const {graph, add, roots} = builder('budget-chain', 10, 'Many near-overlapping small chunks test the cumulative rather than per-merge extra-byte budget.');
    for (let i = 0; i < 10; i++) add(`small-${i}`, 4000, roots.filter(r => r !== i && r !== (i + 1) % 10));
    result.push(graph);
  }
  {
    const {graph, add} = builder('disjoint', 8, 'Unrelated pairs have no shared absorption hosts and should use duplication.');
    for (let i = 0; i < 8; i += 2) add(`pair-${i}`, 8000, [i, i + 1]);
    result.push(graph);
  }
  result.push(generated(7, 'localized'));
  result[result.length - 1].id = 'localized-pressure';
  {
    const {graph, add} = builder('mandatory-floor', 2, 'Twenty-seven incompatible mandatory resources make the request limit infeasible on route 0.');
    for (let i = 0; i < 27; i++) add(`resource-${i}`, 3000, [0], false, 1, `raw-${i}`, true);
    result.push(graph);
  }
  {
    const {graph, add} = builder('intersection-residual', 4, 'A serves 0/1/2; B serves 1/2/3. Intersection merging can retain A and B for exclusive consumers.');
    add('A', 40_000, [0, 1, 2]); add('B', 50_000, [1, 2, 3]);
    result.push(graph);
  }
  {
    const {graph, add, roots} = builder('large-near-overlap', 12, 'Five 400 KB chunks with nearly identical consumers test sharing beyond small-chunk examples.');
    for (let i = 0; i < 5; i++) add(`large-${i}`, 400_000, roots.filter(r => r !== i));
    result.push(graph);
  }
  {
    const graph = generated(1, 'overlap');
    graph.id = 'large-overlap-pressure';
    graph.description = 'The overlap-1 graph with shared asset sizes multiplied by ten; consumer sets and change rates are unchanged, and request pressure requires consolidation.';
    for (const b of graph.bundles.filter(b => !b.mandatory)) for (const a of b.assets) graph.assets[a].size *= 10;
    result.push(graph);
  }
  for (const together of [true, false]) {
    const {graph, add} = builder(together ? 'navigation-together' : 'navigation-apart', 6,
      together ? 'Navigation stays within pairs needing A, B, or A+B; content and first-load probabilities match navigation-apart.' :
        'Navigation crosses between A/B-only routes and A+B routes; content and first-load probabilities match navigation-together.');
    add('A', 80_000, [0, 1, 4, 5]); add('B', 80_000, [2, 3, 4, 5]);
    // Together with the entry, these leave one request slot for optional JS.
    // This makes both navigation scenarios require consolidation at the same
    // default limit, without altering A/B's consumer sets or change rates.
    for (let i = 0; i < 23; i++) add(`protected-${i}`, 1000, [0, 1, 2, 3, 4, 5], false, 1, `protected-${i}`, true);
    graph.description += ' Twenty-three protected requests leave one optional JS request under the default cap.';
    const dest = together ? [1, 0, 3, 2, 5, 4] : [4, 5, 4, 5, 0, 2];
    graph.transitions = dest.map(to => graph.roots.map((_, r) => Number(r === to)));
    result.push(graph);
  }
  return result;
}

export const profiles = ['clustered', 'overlap', 'localized', 'mixed'];
export function generated(seed, profile = 'clustered') {
  const rng = random(seed);
  const count = profile === 'overlap' ? 10 : 12;
  const {graph, add, roots} = builder(`${profile}-${seed}`, count, `Seed ${seed}; ${profile} synthetic consumer sets.`);
  const chunks = profile === 'localized' ? 42 : 36;
  for (let i = 0; i < chunks; i++) {
    let loads;
    if (profile === 'localized') {
      loads = [0, ...roots.slice(1).filter(() => rng() < 0.22)];
    } else if (profile === 'clustered') {
      const cluster = Math.floor(rng() * 3);
      loads = roots.filter(r => rng() < (Math.floor(r / 4) === cluster ? 0.85 : 0.08));
    } else if (profile === 'overlap') {
      loads = roots.filter(() => rng() < 0.75);
    } else {
      const fraction = 0.1 + rng() * 0.7;
      loads = roots.filter(() => rng() < fraction);
    }
    while (loads.length < 2) {
      const r = Math.floor(rng() * count);
      if (!loads.includes(r)) loads.push(r);
    }
    const size = profile === 'localized' ? 30_000 + Math.floor(rng() * 50_000) :
      Math.floor((rng() < 0.65 ? 2000 + rng() * 22_000 : 30_000 + rng() * 80_000));
    add(`shared-${i}`, size, loads, rng() < 0.25);
  }
  // Canonicalization in the builder reproduces exact consumer-set grouping.
  return graph;
}
