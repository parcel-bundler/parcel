//! Consolidate registration-only JS payloads without changing loading boundaries.
//! Consumer sets describe eager loading closures, not just direct references.
//! Every accepted move reduces requests without increasing downloaded bytes in any closure.
//! One greedy pass runs to a fixed point, taking constraint-relief moves and
//! strictly cost-reducing deduplication merges from a shared candidate pool.
//!
//! A move's effect is computed in closed form from the current consumer sets
//! (`Search::assess`): hosts only receive payloads their consumers already load
//! and parents are only redirected to hosts their consumers already load, so
//! the only closure change a move can make is removing the source from some
//! roots. The full state is rebuilt from the layout after each accepted move,
//! and candidates wait in a lazily re-verified priority queue rather than
//! being re-enumerated every round.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use super::*;
use parcel_core::{AssetFlags, LogLevel};

#[cfg(test)]
#[path = "optimizer_tests.rs"]
mod tests;

/// Cost differences below this threshold are ties: float noise must not drive moves.
const COST_EPSILON: f64 = 1e-6;

/// Two-piece concave curve estimating bytes on the wire for a file: the first
/// `w` bytes compress at the worse ratio `r + k`, the remainder at `r`, so
/// each additional file costs about `k·w` extra transfer. Parameters were
/// fitted on a production build (7.6-8.0% median per-file error,
/// cross-validated on measured pairwise merge savings), then converted
/// from output to estimate units with the measured output/source factor ~0.57.
/// The per-merge saving `k·w` (~1KB) is invariant under that conversion.
#[derive(Clone, Copy)]
struct WireCurve {
  /// Marginal compression ratio past the warmup region.
  r: f64,
  /// Additional ratio paid on the first `w` bytes of each file.
  k: f64,
  /// Warmup width in estimated source bytes.
  w: f64,
}

impl WireCurve {
  fn new(compression: Compression) -> Self {
    match compression {
      Compression::None => WireCurve {
        r: 1.0,
        k: 0.0,
        w: 0.0,
      },
      Compression::Gzip => WireCurve {
        r: 0.12,
        k: 0.15,
        w: 7168.0,
      },
      Compression::Brotli => WireCurve {
        r: 0.10,
        k: 0.14,
        w: 7168.0,
      },
    }
  }

  /// Estimated transfer bytes for a file of estimated size `m`.
  fn size(&self, m: usize) -> f64 {
    self.r * m as f64 + self.k * (m as f64).min(self.w)
  }

  /// A linear curve means only deduplication can strictly reduce cost.
  fn is_linear(&self) -> bool {
    self.k == 0.0
  }
}

#[derive(Clone)]
struct Layout {
  /// Asset placements by bundle index.
  assets: Vec<Vec<AssetIndex>>,
  /// Explicit outgoing bundle references. Removed bundles have none.
  references: Vec<Vec<usize>>,
  /// Bundle indices still in the layout; removed slots remain until final compaction.
  live: FixedBitSet,
}

impl Layout {
  fn new(assets: Vec<Vec<AssetIndex>>, references: Vec<Vec<usize>>) -> Self {
    let mut live = FixedBitSet::with_capacity(assets.len());
    live.insert_range(..);
    Layout {
      assets,
      references,
      live,
    }
  }
}

/// Everything derived from a layout. Rebuilt in full after each accepted move.
#[derive(Clone)]
struct State {
  /// Root indices whose eager loading closure includes each bundle.
  consumers: Vec<FixedBitSet>,
  /// Live bundles in each bundle's eager closure, including itself.
  reach: Vec<FixedBitSet>,
  /// Live bundles explicitly referencing each bundle.
  ref_parents: Vec<Vec<usize>>,
  /// Live bundles whose assets eagerly load each bundle.
  load_parents: Vec<Vec<usize>>,
  /// Number of non-inline bundles loaded by each root.
  requests: Vec<usize>,
  /// Estimated JS bytes loaded by each root, excluding inline bundles.
  bytes: Vec<usize>,
  /// Estimated JS payload size of each bundle; non-JS assets contribute zero.
  sizes: Vec<usize>,
  /// Sum of asset edit weights in each bundle, including duplicated placements.
  rates: Vec<f64>,
  /// Expected download and cache-invalidation cost contributed by each bundle.
  costs: Vec<f64>,
  /// Sum of request-limit overruns across all roots; zero when the limit is disabled.
  excess: usize,
  /// Number of undersized, unprotected bundle/root pairs, not distinct bundles.
  small: usize,
  /// Total of the per-bundle costs, summed in bundle-index order.
  cost: f64,
}

impl State {
  /// Both search constraints are satisfied; the search stops here.
  fn within_limits(&self) -> bool {
    self.small == 0 && self.excess == 0
  }
}

struct Model<'a> {
  /// Check every candidate against full recomputation; disabled for timing tests.
  #[cfg(test)]
  check_deltas: bool,
  /// Merge thresholds, scoring weights, and manual grouping rules.
  config: &'a DefaultBundler,
  /// Original bundle metadata; indices stay fixed throughout the search.
  bundles: &'a [Bundle],
  /// Loading-boundary bundle indices; positions in this vector are root indices.
  roots: Vec<usize>,
  /// Bundles whose payload must stay intact and live. They may still receive
  /// assets as hosts, and may donate copies to relieve request pressure.
  protected: FixedBitSet,
  /// Bundles eligible to receive assets, subject to target and content compatibility.
  hosts: FixedBitSet,
  /// Content type per bundle, used to require compatible packaging for merges.
  packagers: Vec<Option<ContentType>>,
  /// Estimated bytes per asset; unplaced and non-JS assets have zero weight.
  sizes: Vec<usize>,
  /// Edit weights per asset: one for source JS, the configured rate for dependencies,
  /// and zero for unplaced or non-JS assets.
  rates: Vec<f64>,
  /// Total edit weight over distinct assets; duplication does not change this denominator.
  total_rate: f64,
  /// Eager bundle targets per asset, carried along when the asset is duplicated.
  asset_requests: Vec<Vec<usize>>,
  /// Estimate-to-transfer curve for the configured compression.
  wire: WireCurve,
}

pub(super) fn optimize(
  config: &DefaultBundler,
  graph: &AssetGraph,
  bundles: &mut Vec<Bundle>,
  root_bundles: &HashMap<AssetIndex, RootBundle>,
  resolutions: &mut HashMap<DependencyId, BundleGraphDependencyResolution>,
  options: &ParcelOptions,
) -> Result<(), DiagnosticList> {
  if config.min_bundle_size == 0
    && config.max_parallel_requests == 0
    && config.compression == Compression::None
  {
    return Ok(());
  }
  let mut roots: Vec<_> = root_bundles.values().map(|r| r.load).collect();
  roots.sort_unstable_by_key(|&r| (bundles[r].id, r));
  roots.dedup();
  let mut protected = FixedBitSet::with_capacity(bundles.len());
  for &root in &roots {
    protected.insert(root);
  }
  let mut asset_requests = vec![Vec::new(); graph.assets.len()];
  for (id, resolution) in resolutions.iter() {
    if let BundleGraphDependencyResolution::Bundle { bundle_index, .. } = resolution {
      let target = *bundle_index as usize;
      // URL and lazy resolutions must remain addressable even if they aren't
      // eagerly requested in the importing activation.
      protected.insert(target);
      let dep = &graph.asset(id.asset).dependencies[id.dependency];
      if dep.priority != Priority::Lazy
        && (dep.priority == Priority::Parallel || dep.specifier_type != SpecifierType::Url)
        && dep.bundle_behavior != BundleBehavior::Isolated
        && bundles[target].bundle_behavior != BundleBehavior::Isolated
      {
        asset_requests[id.asset.index()].push(target);
      }
    }
  }
  for requests in &mut asset_requests {
    requests.sort_unstable();
    requests.dedup();
  }
  let mut hosts = FixedBitSet::with_capacity(bundles.len());
  let mut packagers = Vec::with_capacity(bundles.len());
  // Protected bundles cannot donate their payload, but may still receive assets
  // as hosts. Manual groups and non-JS/inline/isolated bundles do neither.
  for (index, bundle) in bundles.iter().enumerate() {
    let can_host = bundle.ty == AssetType::Js
      && bundle.bundle_behavior == BundleBehavior::None
      && !bundle.assets.iter().chain(&bundle.entry_assets).any(|&a| {
        config
          .manual_shared_bundle(graph.asset(a), options)
          .is_some()
      });
    hosts.set(index, can_host);
    if !can_host
      || bundle.main_entry_asset.is_some()
      || bundle
        .flags
        .intersects(BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME)
    {
      protected.insert(index);
    }
    packagers.push(
      bundle
        .assets
        .first()
        .or(bundle.main_entry_asset.as_ref())
        .map(|&a| graph.asset(a).content.ty()),
    );
  }
  if protected.is_full()
    && (config.max_parallel_requests == 0 || bundles.len() <= config.max_parallel_requests)
  {
    return Ok(());
  }

  // Estimate each placed JS asset once without serializing ASTs.
  // Do not read stale or unplaced assets retained by incremental asset graphs.
  let mut sizes = vec![0; graph.assets.len()];
  let mut rates = vec![0.0; graph.assets.len()];
  let mut seen = FixedBitSet::with_capacity(graph.assets.len());
  for bundle in bundles.iter() {
    for &a in &bundle.assets {
      if seen.contains(a.index()) {
        continue;
      }
      seen.insert(a.index());
      let asset = graph.asset(a);
      // Non-JS outputs are fixed by this pass and still count as requests.
      // Their constant byte costs do not affect JS merge comparisons.
      if asset.ty != AssetType::Js {
        continue;
      }
      sizes[a.index()] = asset.content.estimate_size()?;
      rates[a.index()] = if asset.flags.contains(AssetFlags::IS_SOURCE) {
        1.0
      } else {
        config.dependency_change_rate
      };
    }
  }
  let model = Model {
    #[cfg(test)]
    check_deltas: true,
    config,
    bundles,
    roots,
    protected,
    hosts,
    packagers,
    sizes,
    total_rate: rates.iter().sum(),
    rates,
    asset_requests,
    wire: WireCurve::new(config.compression),
  };
  let initial = Layout::new(
    bundles.iter().map(|b| b.assets.clone()).collect(),
    bundles
      .iter()
      .map(|b| b.referenced_bundles.clone())
      .collect(),
  );
  let initial_state = model.state(&initial);
  let initial_requests: usize = initial_state.requests.iter().sum();

  let (mut chosen, result) = model.run(initial, initial_state);
  if !result.within_limits() {
    options.reporters.log(LogLevel::Warn, &format!(
      "Bundle consolidation left {} excess requests and {} undersized shared-bundle occurrences; no further safe merge was found.",
      result.excess, result.small
    ));
  }
  // Every accepted move strictly reduces total requests, so an unchanged total
  // means the search left the layout untouched.
  if result.requests.iter().sum::<usize>() == initial_requests {
    return Ok(());
  }

  // Keep the original DFS packaging order, including after multiple moves.
  let mut order = vec![usize::MAX; graph.assets.len()];
  for (rank, (a, _, _)) in graph.dfs().enumerate() {
    order[a.index()] = rank;
  }
  let mut remap = vec![usize::MAX; bundles.len()];
  for (next, i) in chosen.live.ones().enumerate() {
    remap[i] = next;
  }
  let mut output = Vec::with_capacity(chosen.live.count_ones(..));
  for (i, mut bundle) in std::mem::take(bundles).into_iter().enumerate() {
    if !chosen.live.contains(i) {
      continue;
    }
    bundle.assets = std::mem::take(&mut chosen.assets[i]);
    // CSS bundle order is cascade order, planned per context; only JS bundles
    // are resorted into DFS packaging order after moves.
    if bundle.ty != AssetType::Css {
      bundle.assets.sort_by_key(|a| order[a.index()]);
    }
    bundle.referenced_bundles = std::mem::take(&mut chosen.references[i]);
    for r in &mut bundle.referenced_bundles {
      assert_ne!(remap[*r], usize::MAX, "reference to a removed bundle");
      *r = remap[*r];
    }
    output.push(bundle);
  }
  for resolution in resolutions.values_mut() {
    if let BundleGraphDependencyResolution::Bundle { bundle_index, .. } = resolution {
      assert_ne!(
        remap[*bundle_index as usize],
        usize::MAX,
        "removed loading boundary"
      );
      *bundle_index = remap[*bundle_index as usize] as u32;
    }
  }
  *bundles = output;
  Ok(())
}

impl Model<'_> {
  /// Full evaluation of a layout. Runs once per accepted move and is the test
  /// oracle for `Search::assess`.
  fn state(&self, layout: &Layout) -> State {
    let n = layout.assets.len();
    let root_count = self.roots.len();
    let mut sizes = Vec::with_capacity(n);
    let mut rates = Vec::with_capacity(n);
    let mut loads = Vec::with_capacity(n);
    for assets in &layout.assets {
      let mut size = 0;
      let mut rate = 0.0;
      let mut asset_loads = Vec::new();
      for a in assets {
        size += self.sizes[a.index()];
        rate += self.rates[a.index()];
        asset_loads.extend(self.asset_requests[a.index()].iter().copied());
      }
      asset_loads.sort_unstable();
      asset_loads.dedup();
      sizes.push(size);
      rates.push(rate);
      loads.push(asset_loads);
    }

    // Post-order over live bundles following references and asset loads, so
    // that a bundle is processed after everything it reaches except through
    // cycles, which the fixed-point passes below close.
    let edge = |b: usize, i: usize| -> Option<usize> {
      let references = &layout.references[b];
      if i < references.len() {
        Some(references[i])
      } else {
        loads[b].get(i - references.len()).copied()
      }
    };
    let mut order = Vec::with_capacity(n);
    let mut visited = FixedBitSet::with_capacity(n);
    let mut stack: Vec<(usize, usize)> = Vec::new();
    for start in layout.live.ones() {
      if visited.put(start) {
        continue;
      }
      stack.push((start, 0));
      while let Some(&(b, i)) = stack.last() {
        match edge(b, i) {
          Some(c) => {
            stack.last_mut().unwrap().1 += 1;
            if layout.live.contains(c) && !visited.put(c) {
              stack.push((c, 0));
            }
          }
          None => {
            stack.pop();
            order.push(b);
          }
        }
      }
    }
    let mut reach = vec![FixedBitSet::with_capacity(n); n];
    for &b in &order {
      reach[b].insert(b);
    }
    loop {
      let mut changed = false;
      for &b in &order {
        let mut row = std::mem::take(&mut reach[b]);
        let before = row.count_ones(..);
        for &c in layout.references[b].iter().chain(&loads[b]) {
          if c != b && layout.live.contains(c) {
            row.union_with(&reach[c]);
          }
        }
        changed |= row.count_ones(..) != before;
        reach[b] = row;
      }
      if !changed {
        break;
      }
    }

    let mut consumers = vec![FixedBitSet::with_capacity(root_count); n];
    let mut requests = vec![0usize; root_count];
    let mut bytes = vec![0; root_count];
    for (context, &root) in self.roots.iter().enumerate() {
      for b in reach[root].ones() {
        consumers[b].insert(context);
        if self.bundles[b].bundle_behavior != BundleBehavior::Inline {
          requests[context] += 1;
          bytes[context] += sizes[b];
        }
      }
    }
    let mut ref_parents = vec![Vec::new(); n];
    let mut load_parents = vec![Vec::new(); n];
    for p in layout.live.ones() {
      for &t in &layout.references[p] {
        ref_parents[t].push(p);
      }
      for &t in &loads[p] {
        load_parents[t].push(p);
      }
    }
    let mut small = 0;
    let mut cost = 0.0;
    let mut costs = vec![0.0; n];
    for (b, roots) in consumers.iter().enumerate() {
      let k = roots.count_ones(..);
      if k == 0 {
        continue;
      }
      if self.undersized(b, sizes[b]) {
        small += k;
      }
      costs[b] = self.bundle_cost(sizes[b], rates[b], k);
      cost += costs[b];
    }
    let excess = requests.iter().map(|&r| self.request_excess(r)).sum();
    State {
      consumers,
      reach,
      ref_parents,
      load_parents,
      requests,
      bytes,
      sizes,
      rates,
      costs,
      excess,
      small,
      cost,
    }
  }

  /// Pairwise merge compatibility. Callers pre-filter with the `hosts` set.
  fn compatible(&self, source: usize, host: usize) -> bool {
    source != host
      && self.packagers[source] == self.packagers[host]
      && self.bundles[source].target == self.bundles[host].target
  }

  /// Whether a bundle's size counts against the minimum-size constraint.
  fn undersized(&self, bundle: usize, size: usize) -> bool {
    !self.protected.contains(bundle) && size < self.config.min_bundle_size
  }

  fn bundle_cost(&self, size: usize, rate: f64, consumers: usize) -> f64 {
    if consumers == 0 {
      return 0.0;
    }
    let n = self.roots.len();
    // Assume a uniformly chosen first root and optionally a different second
    // root. `second` counts a cache miss only on that second visit; invalidation
    // adds the expected download after one edit, weighted by asset change rates.
    let probability = consumers as f64 / n as f64;
    let second = if n > 1 {
      ((n - consumers) * consumers) as f64 / (n * (n - 1)) as f64
    } else {
      0.0
    };
    let invalidation = if self.total_rate > 0.0 {
      probability * rate / self.total_rate
    } else {
      0.0
    };
    self.wire.size(size)
      * (probability + (1.0 - self.config.first_page_load_priority) * second + invalidation)
  }

  fn request_excess(&self, requests: usize) -> usize {
    if self.config.max_parallel_requests == 0 {
      0
    } else {
      requests.saturating_sub(self.config.max_parallel_requests)
    }
  }

  fn run(&self, layout: Layout, state: State) -> (Layout, State) {
    let mut search = Search::new(self, layout, state);
    search.run();
    (search.layout, search.state)
  }
}

/// Apply a move to a layout: copy the source payload and references into each
/// host, repoint redirected parents, and drop the source if nothing keeps it.
fn apply(
  layout: &mut Layout,
  members: &mut FixedBitSet,
  source: usize,
  hosts: &[usize],
  redirects: &[(usize, usize)],
  alive: bool,
) {
  let payload = layout.assets[source].clone();
  let references = layout.references[source].clone();
  for &host in hosts {
    members.clear();
    members.extend(layout.assets[host].iter().map(|a| a.index()));
    for &a in &payload {
      if !members.put(a.index()) {
        layout.assets[host].push(a);
      }
    }
    for &r in &references {
      if r != host && !layout.references[host].contains(&r) {
        layout.references[host].push(r);
      }
    }
  }
  for &(parent, target) in redirects {
    let references = &mut layout.references[parent];
    references.retain(|&r| r != source);
    if target != parent && !references.contains(&target) {
      references.push(target);
    }
  }
  if !alive {
    layout.live.set(source, false);
    layout.references[source].clear();
  }
}

/// Payload a host would gain: the source's assets it does not already contain.
struct HostInfo {
  bundle: usize,
  size: usize,
  rate: f64,
}

/// Result of scoring a move, whether or not it was accepted.
struct Verdict {
  /// Cost change, normalized by constraint relief when the move increases cost.
  score: f64,
  /// Candidate's totals after the move.
  cost: f64,
  small: usize,
  excess: usize,
}

struct Assessment {
  /// Parents whose reference to the source is replaced by a reference to the
  /// paired host; a parent paired with itself is a host and simply drops it.
  redirects: Vec<(usize, usize)>,
  /// Whether the source stays live: protected, or still referenced.
  alive: bool,
  accepted: Option<Verdict>,
}

/// Queue entry. Ordered so the heap yields the lowest score first, then the
/// earliest generation order, matching a stable scan over sources and covers.
#[derive(PartialEq)]
struct Entry {
  score: f64,
  order: (usize, u64, usize),
  source: usize,
  generation: u32,
  cover: usize,
}

impl Eq for Entry {}

impl Ord for Entry {
  fn cmp(&self, other: &Self) -> Ordering {
    other
      .score
      .total_cmp(&self.score)
      .then_with(|| other.order.cmp(&self.order))
  }
}

impl PartialOrd for Entry {
  fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
    Some(self.cmp(other))
  }
}

const UNKNOWN: usize = usize::MAX;
const NONE: usize = usize::MAX - 1;

struct Search<'m, 'a> {
  model: &'m Model<'a>,
  layout: Layout,
  state: State,
  /// Root index of each root bundle; `usize::MAX` otherwise.
  root_of: Vec<usize>,
  /// Bundles that never count as requests.
  inline: FixedBitSet,
  concave: bool,
  // Derived from the state after each move.
  /// Assets placed in more than one live bundle.
  duplicated: FixedBitSet,
  /// Roots over the request limit.
  pressured: FixedBitSet,
  /// The two largest live payloads, bounding any donor's best merge partner.
  max_sizes: [usize; 2],
  // Prepared per source.
  prepared: usize,
  /// Reference parents of the prepared source that each root loads.
  parents: Vec<Vec<usize>>,
  parents_used: Vec<usize>,
  /// Roots that keep the prepared source through asset loads.
  load_still: FixedBitSet,
  // Scratch.
  members: FixedBitSet,
  seen_assets: FixedBitSet,
  covered: FixedBitSet,
  dropped: FixedBitSet,
  seen_roots: FixedBitSet,
  multi: FixedBitSet,
  redirect: Vec<usize>,
  redirect_touched: Vec<usize>,
  // Candidate queue.
  heap: BinaryHeap<Entry>,
  covers: Vec<Vec<usize>>,
  generation: Vec<u32>,
}

impl<'m, 'a> Search<'m, 'a> {
  fn new(model: &'m Model<'a>, layout: Layout, state: State) -> Self {
    let bundles = layout.assets.len();
    let roots = model.roots.len();
    let assets = model.sizes.len();
    let mut root_of = vec![usize::MAX; bundles];
    for (r, &b) in model.roots.iter().enumerate() {
      root_of[b] = r;
    }
    let mut inline = FixedBitSet::with_capacity(bundles);
    for (b, bundle) in model.bundles.iter().enumerate() {
      inline.set(b, bundle.bundle_behavior == BundleBehavior::Inline);
    }
    Search {
      model,
      layout,
      state,
      root_of,
      inline,
      concave: !model.wire.is_linear(),
      duplicated: FixedBitSet::with_capacity(assets),
      pressured: FixedBitSet::with_capacity(roots),
      max_sizes: [0; 2],
      prepared: usize::MAX,
      parents: vec![Vec::new(); roots],
      parents_used: Vec::new(),
      load_still: FixedBitSet::with_capacity(roots),
      members: FixedBitSet::with_capacity(assets),
      seen_assets: FixedBitSet::with_capacity(assets),
      covered: FixedBitSet::with_capacity(roots),
      dropped: FixedBitSet::with_capacity(roots),
      seen_roots: FixedBitSet::with_capacity(roots),
      multi: FixedBitSet::with_capacity(roots),
      redirect: vec![UNKNOWN; bundles],
      redirect_touched: Vec::new(),
      heap: BinaryHeap::new(),
      covers: Vec::new(),
      generation: vec![0; bundles],
    }
  }

  /// Lazy greedy search: every popped candidate is re-scored against the
  /// current state and applied only while it still beats the next entry.
  /// Moves regenerate candidates for the bundles they touched; a final
  /// full sweep confirms that no acceptable move remains.
  fn run(&mut self) {
    self.refresh();
    self.sweep();
    loop {
      let Some(entry) = self.heap.pop() else {
        self.sweep();
        if self.heap.is_empty() {
          break;
        }
        continue;
      };
      if entry.generation != self.generation[entry.source] {
        continue;
      }
      let cover = self.covers[entry.cover].clone();
      let Some(assessment) = self.assess(entry.source, &cover) else {
        continue;
      };
      let Some(verdict) = &assessment.accepted else {
        continue;
      };
      if self
        .heap
        .peek()
        .is_some_and(|next| verdict.score > next.score)
      {
        self.heap.push(Entry {
          score: verdict.score,
          ..entry
        });
        continue;
      }
      self.commit(entry.source, &cover, &assessment);
    }
  }

  fn sweep(&mut self) {
    for b in 0..self.generation.len() {
      if self.layout.live.contains(b) {
        self.regenerate(b);
      }
    }
  }

  fn regenerate(&mut self, source: usize) {
    self.generation[source] += 1;
    self.generate(source);
  }

  fn commit(&mut self, source: usize, hosts: &[usize], assessment: &Assessment) {
    let old_consumers = self.state.consumers[source].clone();
    let old_references = self.layout.references[source].clone();
    apply(
      &mut self.layout,
      &mut self.members,
      source,
      hosts,
      &assessment.redirects,
      assessment.alive,
    );
    self.state = self.model.state(&self.layout);
    #[cfg(debug_assertions)]
    if let Some(verdict) = &assessment.accepted {
      debug_assert_eq!(
        (self.state.small, self.state.excess),
        (verdict.small, verdict.excess)
      );
      debug_assert!(
        (self.state.cost - verdict.cost).abs() <= 1e-6 * self.state.cost.abs().max(1.0)
      );
    }
    self.refresh();
    // Scores of untouched candidates can only get worse, and their validity
    // is re-checked when they are popped. Regenerate where new candidates can
    // appear: the changed source and hosts, bundles that gained the hosts as
    // parents, and sources the shrunken source newly qualifies to host.
    let mut touched = hosts.to_vec();
    touched.extend(old_references);
    if self.layout.live.contains(source) {
      touched.push(source);
      let consumers = &self.state.consumers;
      touched.extend(self.layout.live.ones().filter(|&b| {
        b != source
          && consumers[source].is_subset(&consumers[b])
          && !old_consumers.is_subset(&consumers[b])
      }));
    }
    touched.sort_unstable();
    touched.dedup();
    for b in touched {
      if self.layout.live.contains(b) {
        self.regenerate(b);
      }
    }
  }

  fn refresh(&mut self) {
    self.prepared = usize::MAX;
    self.seen_assets.clear();
    self.duplicated.clear();
    self.max_sizes = [0; 2];
    for b in self.layout.live.ones() {
      for a in &self.layout.assets[b] {
        if self.seen_assets.put(a.index()) {
          self.duplicated.insert(a.index());
        }
      }
      let size = self.state.sizes[b];
      if size > self.max_sizes[0] {
        self.max_sizes = [size, self.max_sizes[0]];
      } else if size > self.max_sizes[1] {
        self.max_sizes[1] = size;
      }
    }
    self.pressured.clear();
    for (r, &requests) in self.state.requests.iter().enumerate() {
      if self.model.request_excess(requests) > 0 {
        self.pressured.insert(r);
      }
    }
  }

  /// Donors: protected outputs may donate copies of their payload, but only
  /// to relieve request pressure (the source itself is never changed or
  /// removed, so lazy and URL targets stay addressable), and empty facades
  /// never donate. Other bundles donate when undersized, under pressure,
  /// overlapping another output, or able to cross the wire curve's knee with
  /// their best partner: below it the curve is linear, where per-root bytes
  /// are unchanged while the second-visit and invalidation terms can only grow.
  fn eligible_source(&self, b: usize) -> bool {
    if !self.layout.live.contains(b) {
      return false;
    }
    let pressure = !self.state.consumers[b].is_disjoint(&self.pressured);
    if self.model.protected.contains(b) {
      return self.model.hosts.contains(b) && !self.layout.assets[b].is_empty() && pressure;
    }
    let size = self.state.sizes[b];
    let partner = if size == self.max_sizes[0] {
      self.max_sizes[1]
    } else {
      self.max_sizes[0]
    };
    self.model.undersized(b, size)
      || pressure
      || (self.concave && (size + partner) as f64 > self.model.wire.w)
      || self.layout.assets[b]
        .iter()
        .any(|a| self.duplicated.contains(a.index()))
  }

  /// Copies must not reach roots that never loaded the source, and a host
  /// downstream of the source would introduce a reference cycle.
  fn eligible_host(&self, source: usize, host: usize) -> bool {
    self.layout.live.contains(host)
      && self.model.hosts.contains(host)
      && self.model.compatible(source, host)
      && !self.state.consumers[host].is_clear()
      && self.state.consumers[host].is_subset(&self.state.consumers[source])
      && !self.state.reach[source].contains(host)
  }

  fn host_info(&mut self, source: usize, host: usize) -> HostInfo {
    self.members.clear();
    self
      .members
      .extend(self.layout.assets[host].iter().map(|a| a.index()));
    let mut info = HostInfo {
      bundle: host,
      size: 0,
      rate: 0.0,
    };
    for a in &self.layout.assets[source] {
      if !self.members.contains(a.index()) {
        info.size += self.model.sizes[a.index()];
        info.rate += self.model.rates[a.index()];
      }
    }
    info
  }

  /// Index the source's reference parents by the roots that load them, and
  /// collect the roots that keep the source through asset loads.
  fn prepare(&mut self, source: usize) {
    if self.prepared == source {
      return;
    }
    self.prepared = source;
    for &r in &self.parents_used {
      self.parents[r].clear();
    }
    self.parents_used.clear();
    for &p in &self.state.ref_parents[source] {
      for r in self.state.consumers[p].ones() {
        if self.parents[r].is_empty() {
          self.parents_used.push(r);
        }
        self.parents[r].push(p);
      }
    }
    self.load_still.clear();
    for &q in &self.state.load_parents[source] {
      self.load_still.union_with(&self.state.consumers[q]);
    }
  }

  /// Redirect a parent only to a host its consumers already load, without
  /// creating a cycle. Unredirected parents keep the source alive, allowing
  /// selective duplication for request relief.
  fn redirected(&mut self, parent: usize, hosts: &[usize]) -> Option<usize> {
    match self.redirect[parent] {
      UNKNOWN => {}
      NONE => return None,
      target => return Some(target),
    }
    self.redirect_touched.push(parent);
    let target = if hosts.contains(&parent) {
      Some(parent)
    } else {
      let consumers = &self.state.consumers;
      let reach = &self.state.reach;
      hosts.iter().copied().find(|&host| {
        consumers[parent].is_subset(&consumers[host]) && !reach[host].contains(parent)
      })
    };
    self.redirect[parent] = target.unwrap_or(NONE);
    target
  }

  /// Score moving the source's payload into `hosts`, in closed form. Returns
  /// `None` when a precondition no longer holds; otherwise the assessment
  /// says whether the move is acceptable and what it changes.
  fn assess(&mut self, source: usize, hosts: &[usize]) -> Option<Assessment> {
    if hosts.is_empty()
      || !self.eligible_source(source)
      || hosts.iter().any(|&h| !self.eligible_host(source, h))
    {
      return None;
    }
    self.prepare(source);
    let infos: Vec<HostInfo> = hosts.iter().map(|&h| self.host_info(source, h)).collect();

    // Roots loading a copy after the move. Each keeps the source unless every
    // parent it loads is redirected; roots loading it directly or through
    // asset loads always keep it.
    self.covered.clear();
    for &h in hosts {
      self.covered.union_with(&self.state.consumers[h]);
    }
    for &p in &self.redirect_touched {
      self.redirect[p] = UNKNOWN;
    }
    self.redirect_touched.clear();
    self.dropped.clear();
    let own_root = self.root_of[source];
    let covered = std::mem::take(&mut self.covered);
    for r in covered.ones() {
      let parents = std::mem::take(&mut self.parents[r]);
      let mut all = true;
      for &p in &parents {
        all &= self.redirected(p, hosts).is_some();
      }
      self.parents[r] = parents;
      if all && r != own_root && !self.load_still.contains(r) {
        self.dropped.insert(r);
      }
    }
    self.covered = covered;
    let redirects: Vec<(usize, usize)> = self
      .redirect_touched
      .iter()
      .filter_map(|&p| match self.redirect[p] {
        UNKNOWN | NONE => None,
        target => Some((p, target)),
      })
      .collect();
    // Parents never examined have a consumer outside every host's set.
    let alive = self.model.protected.contains(source)
      || self.state.ref_parents[source]
        .iter()
        .any(|&p| matches!(self.redirect[p], UNKNOWN | NONE));

    let assessment = Assessment {
      redirects,
      alive,
      accepted: self.verdict(source, &infos),
    };
    #[cfg(test)]
    if self.model.check_deltas {
      tests::assert_candidate(self, source, hosts, &assessment);
    }
    Some(assessment)
  }

  /// Validity and score given the roots that drop the source (`self.dropped`).
  fn verdict(&mut self, source: usize, infos: &[HostInfo]) -> Option<Verdict> {
    let state = &self.state;
    let model = self.model;
    // Every accepted move must free a request somewhere.
    if self.inline.contains(source) || self.dropped.is_clear() {
      return None;
    }
    // A copy is an extra download for any root that still loads the source,
    // and two copies duplicate bytes unless they overlap the host's existing
    // assets enough to fit within the removed source.
    let size = state.sizes[source];
    for info in infos {
      if info.size > 0 && !state.consumers[info.bundle].is_subset(&self.dropped) {
        return None;
      }
    }
    self.seen_roots.clear();
    self.multi.clear();
    for info in infos {
      let consumers = state.consumers[info.bundle].as_slice();
      for ((multi, seen), &c) in self
        .multi
        .as_mut_slice()
        .iter_mut()
        .zip(self.seen_roots.as_mut_slice())
        .zip(consumers)
      {
        *multi |= *seen & c;
        *seen |= c;
      }
    }
    for r in self.multi.ones() {
      let added: usize = infos
        .iter()
        .filter(|info| state.consumers[info.bundle].contains(r))
        .map(|info| info.size)
        .sum();
      let limit = if self.dropped.contains(r) { size } else { 0 };
      if added > limit {
        return None;
      }
    }
    let dropped = self.dropped.count_ones(..);
    let excess = state.excess - self.dropped.intersection_count(&self.pressured);
    let mut small = state.small;
    if model.undersized(source, size) {
      small -= dropped;
    }
    let mut change = 0.0;
    for info in infos {
      let h = info.bundle;
      let k = state.consumers[h].count_ones(..);
      let new_size = state.sizes[h] + info.size;
      if model.undersized(h, state.sizes[h]) && !model.undersized(h, new_size) {
        small -= k;
      }
      change += model.bundle_cost(new_size, state.rates[h] + info.rate, k) - state.costs[h];
    }
    let k = state.consumers[source].count_ones(..);
    change += model.bundle_cost(size, state.rates[source], k - dropped) - state.costs[source];
    // Accept a move only when it strictly reduces the remaining violations or
    // strictly reduces cost; either alone qualifies, and neither can worsen.
    let relief = (state.small + state.excess) - (small + excess);
    if relief == 0 && change >= -COST_EPSILON {
      return None;
    }
    // Prefer the largest absolute saving when cost falls; otherwise choose
    // the lowest added cost per constraint violation removed.
    let score = if change < 0.0 {
      change
    } else {
      change / relief as f64
    };
    Some(Verdict {
      score,
      cost: state.cost + change,
      small,
      excess,
    })
  }

  /// Enumerate and score the source's covers: its direct referrers, a greedy
  /// cheapest cover of its consumers, and each single host.
  fn generate(&mut self, source: usize) {
    if !self.eligible_source(source) {
      return;
    }
    let mut hosts: Vec<usize> = self
      .model
      .hosts
      .ones()
      .filter(|&h| self.eligible_host(source, h))
      .collect();
    if hosts.is_empty() {
      return;
    }
    hosts.sort_unstable_by_key(|&h| (self.model.bundles[h].id, h));
    let infos: Vec<HostInfo> = hosts.iter().map(|&h| self.host_info(source, h)).collect();
    let direct: Vec<usize> = hosts
      .iter()
      .copied()
      .filter(|&h| self.layout.references[h].contains(&source))
      .collect();
    let cover = self.greedy_cover(source, &infos);
    let mut covers = Vec::with_capacity(hosts.len() + 2);
    if !direct.is_empty() {
      covers.push(direct.clone());
    }
    if !cover.is_empty() && cover != direct {
      covers.push(cover.clone());
    }
    for &h in &hosts {
      if direct.as_slice() != [h] && cover.as_slice() != [h] {
        covers.push(vec![h]);
      }
    }
    let order = (self.state.sizes[source], self.model.bundles[source].id);
    let generation = self.generation[source];
    for (index, cover) in covers.into_iter().enumerate() {
      let Some(verdict) = self.assess(source, &cover).and_then(|a| a.accepted) else {
        continue;
      };
      self.heap.push(Entry {
        score: verdict.score,
        order: (order.0, order.1, index),
        source,
        generation,
        cover: self.covers.len(),
      });
      self.covers.push(cover);
    }
  }

  fn greedy_cover(&self, source: usize, infos: &[HostInfo]) -> Vec<usize> {
    // Prices do not change as the remaining consumer set shrinks. A host
    // rejected here cannot become eligible later, so one sorted pass is
    // equivalent to repeatedly searching for the cheapest eligible host.
    let mut priced: Vec<_> = infos
      .iter()
      .map(|info| (info.bundle, self.host_price(info)))
      .collect();
    priced.sort_by(|&(a, a_price), &(b, b_price)| {
      a_price
        .total_cmp(&b_price)
        .then_with(|| self.model.bundles[a].id.cmp(&self.model.bundles[b].id))
    });
    let mut cover = Vec::new();
    let mut remaining = self.state.consumers[source].clone();
    for (host, _) in priced {
      if !self.state.consumers[host].is_subset(&remaining) {
        continue;
      }
      remaining.difference_with(&self.state.consumers[host]);
      cover.push(host);
      if remaining.is_clear() {
        break;
      }
    }
    cover
  }

  // Estimate added cost per host consumer to construct a cover, as the exact
  // marginal of `bundle_cost`. The complete candidate is then evaluated
  // exactly, including whether the source survives.
  fn host_price(&self, info: &HostInfo) -> f64 {
    let h = info.bundle;
    // Host consumer sets are never empty, so k is at least one.
    let k = self.state.consumers[h].count_ones(..);
    let before = self
      .model
      .bundle_cost(self.state.sizes[h], self.state.rates[h], k);
    let after = self.model.bundle_cost(
      self.state.sizes[h] + info.size,
      self.state.rates[h] + info.rate,
      k,
    );
    (after - before) / k as f64
  }
}
