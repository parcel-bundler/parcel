//! Consolidate registration-only JS payloads without changing loading boundaries.
//! Consumer sets describe eager loading closures, not just direct references.
//! Every accepted move reduces requests without increasing downloaded bytes in any closure.
//! One greedy pass runs to a fixed point, taking constraint-relief moves and
//! strictly cost-reducing deduplication merges from a shared candidate pool.

use std::rc::Rc;

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
  /// Asset placements by bundle index, shared between candidates until modified.
  assets: Vec<Rc<Vec<AssetIndex>>>,
  /// Explicit outgoing bundle references, shared between candidates until modified.
  references: Vec<Rc<Vec<usize>>>,
  /// Bundle indices still in the layout; removed slots remain until final compaction.
  live: FixedBitSet,
}

impl Layout {
  fn new(assets: Vec<Rc<Vec<AssetIndex>>>, references: Vec<Rc<Vec<usize>>>) -> Self {
    let mut live = FixedBitSet::with_capacity(assets.len());
    live.insert_range(..);
    Layout {
      assets,
      references,
      live,
    }
  }
}

#[derive(Clone)]
struct State {
  /// Root indices whose eager loading closure includes each bundle.
  consumers: Vec<FixedBitSet>,
  /// Number of non-inline bundles loaded by each root.
  requests: Vec<usize>,
  /// Estimated JS bytes loaded by each root, excluding inline bundles.
  bytes: Vec<usize>,
  /// Estimated JS payload size of each bundle; non-JS assets contribute zero.
  sizes: Vec<usize>,
  /// Sum of asset edit weights in each bundle, including duplicated placements.
  rates: Vec<f64>,
  /// Eager bundle dependencies carried by each bundle's assets, separate from references.
  loads: Vec<Rc<Vec<usize>>>,
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

#[cfg_attr(test, derive(Clone))]
struct HostState {
  /// Index of the bundle receiving assets in this candidate.
  bundle: usize,
  /// Host's total estimated JS size after adding assets it did not already contain.
  size: usize,
  /// Host's total asset edit weight after the additions.
  rate: f64,
  /// Host's eager asset dependency loads after the additions.
  loads: Rc<Vec<usize>>,
}

#[cfg_attr(test, derive(Clone))]
struct StateDelta {
  /// Replacement size, edit weight, and dependency loads for candidate hosts.
  hosts: Vec<HostState>,
  /// Replacement consumer sets for changed bundles, paired with their bundle indices.
  consumers: Vec<(usize, FixedBitSet)>,
  /// Changed root totals as (root index, new request count, new estimated bytes).
  roots: Vec<(usize, usize, usize)>,
  /// Replacement cost contributions as (bundle index, new cost).
  costs: Vec<(usize, f64)>,
  /// Candidate's total request-limit overruns, not a difference from the current state.
  excess: usize,
  /// Candidate's total undersized bundle/root pairs.
  small: usize,
  /// Candidate's total cost, including unchanged bundles.
  cost: f64,
}

impl StateDelta {
  fn apply(self, state: &mut State) {
    for host in self.hosts {
      state.sizes[host.bundle] = host.size;
      state.rates[host.bundle] = host.rate;
      state.loads[host.bundle] = host.loads;
    }
    for (bundle, consumers) in self.consumers {
      state.consumers[bundle] = consumers;
    }
    for (root, requests, bytes) in self.roots {
      state.requests[root] = requests;
      state.bytes[root] = bytes;
    }
    for (bundle, cost) in self.costs {
      state.costs[bundle] = cost;
    }
    state.excess = self.excess;
    state.small = self.small;
    state.cost = self.cost;
  }
}

struct Candidate {
  /// Bundle placements and references after this move.
  layout: Layout,
  /// Cached state updates to apply if this candidate wins.
  changes: StateDelta,
  /// Cost change, normalized by constraint relief when the move increases cost.
  score: f64,
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

// Reuse traversal and membership storage across candidate evaluations.
struct Scratch {
  /// Bundle indices visited by the current reachability traversal.
  seen: FixedBitSet,
  /// Pending bundle indices for the current traversal.
  stack: Vec<usize>,
  /// Asset membership of the current host, used to avoid adding duplicates.
  assets: FixedBitSet,
  /// Bundles whose size, edit weight, or consumers require candidate rescoring.
  changed: FixedBitSet,
  /// Bundle index to candidate host entry; usize::MAX means the bundle is not a host.
  host_indices: Vec<usize>,
  /// Bundle index to changed consumer-set entry; usize::MAX means unchanged.
  consumer_indices: Vec<usize>,
  /// Candidate cost contributions by bundle, reused to preserve summation order.
  costs: Vec<f64>,
}

/// Reset `set` to exactly the members of `assets`.
fn set_asset_membership(set: &mut FixedBitSet, assets: &[AssetIndex]) {
  set.clear();
  set.extend(assets.iter().map(|a| a.index()));
}

impl Scratch {
  fn new(bundles: usize, assets: usize) -> Self {
    Self {
      seen: FixedBitSet::with_capacity(bundles),
      stack: Vec::new(),
      assets: FixedBitSet::with_capacity(assets),
      changed: FixedBitSet::with_capacity(bundles),
      host_indices: vec![usize::MAX; bundles],
      consumer_indices: vec![usize::MAX; bundles],
      costs: vec![0.0; bundles],
    }
  }
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
    bundles.iter().map(|b| Rc::new(b.assets.clone())).collect(),
    bundles
      .iter()
      .map(|b| Rc::new(b.referenced_bundles.clone()))
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
  // means both phases left the layout untouched.
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
    bundle.assets = Rc::unwrap_or_clone(std::mem::take(&mut chosen.assets[i]));
    // CSS bundle order is cascade order, planned per context; only JS bundles
    // are resorted into DFS packaging order after moves.
    if bundle.ty != AssetType::Css {
      bundle.assets.sort_by_key(|a| order[a.index()]);
    }
    bundle.referenced_bundles = Rc::unwrap_or_clone(std::mem::take(&mut chosen.references[i]));
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
  // Full evaluation initializes each run and is the test oracle for state_delta.
  fn state(&self, layout: &Layout) -> State {
    let n = self.roots.len();
    let mut consumers = vec![FixedBitSet::with_capacity(n); layout.live.len()];
    let mut requests = vec![0usize; n];
    let mut bytes = vec![0; n];
    // Cache asset dependency loads separately from explicit references. Most
    // bundles have none, so share one empty list rather than allocating for each.
    let mut sizes = Vec::with_capacity(layout.assets.len());
    let mut rates = Vec::with_capacity(layout.assets.len());
    let mut loads = Vec::with_capacity(layout.assets.len());
    let empty_loads = Rc::new(Vec::new());
    for assets in &layout.assets {
      let mut size = 0;
      let mut rate = 0.0;
      let mut asset_loads = Vec::new();
      for a in assets.iter() {
        size += self.sizes[a.index()];
        rate += self.rates[a.index()];
        asset_loads.extend(self.asset_requests[a.index()].iter().copied());
      }
      sizes.push(size);
      rates.push(rate);
      loads.push(if asset_loads.is_empty() {
        empty_loads.clone()
      } else {
        Rc::new(asset_loads)
      });
    }
    let mut stack = Vec::new();
    for (context, &root) in self.roots.iter().enumerate() {
      stack.push(root);
      while let Some(b) = stack.pop() {
        if !layout.live.contains(b) || consumers[b].contains(context) {
          continue;
        }
        consumers[b].insert(context);
        if self.bundles[b].bundle_behavior != BundleBehavior::Inline {
          requests[context] += 1;
          bytes[context] += sizes[b];
        }
        stack.extend(layout.references[b].iter().copied());
        stack.extend(loads[b].iter().copied());
      }
    }
    let mut small = 0;
    let mut cost = 0.0;
    let mut costs = vec![0.0; layout.assets.len()];
    for (b, loads) in consumers.iter().enumerate() {
      let k = loads.count_ones(..);
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
      requests,
      bytes,
      sizes,
      rates,
      loads,
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

  // With no target, collect the entire closure for host filtering. With a
  // target, stop early when checking whether redirecting an edge makes a cycle.
  // `loads` is the current state's cached per-bundle asset dependency loads.
  fn reaches(
    &self,
    layout: &Layout,
    loads: &[Rc<Vec<usize>>],
    from: usize,
    target: Option<usize>,
    scratch: &mut Scratch,
  ) -> bool {
    scratch.seen.clear();
    scratch.stack.clear();
    scratch.stack.push(from);
    while let Some(b) = scratch.stack.pop() {
      if Some(b) == target {
        return true;
      }
      if scratch.seen.contains(b) {
        continue;
      }
      scratch.seen.insert(b);
      scratch.stack.extend(layout.references[b].iter().copied());
      scratch.stack.extend(loads[b].iter().copied());
    }
    false
  }

  fn absorb(
    &self,
    layout: &Layout,
    state: &State,
    source: usize,
    hosts: &[usize],
    parents: &[usize],
    scratch: &mut Scratch,
  ) -> Option<Candidate> {
    if hosts.is_empty() {
      return None;
    }
    let mut next = layout.clone();
    let mut host_states = Vec::with_capacity(hosts.len());
    for &host in hosts {
      let mut changed = HostState {
        bundle: host,
        size: state.sizes[host],
        rate: state.rates[host],
        loads: state.loads[host].clone(),
      };
      set_asset_membership(&mut scratch.assets, &layout.assets[host]);
      for &a in layout.assets[source].iter() {
        if !scratch.assets.put(a.index()) {
          Rc::make_mut(&mut next.assets[host]).push(a);
          changed.size += self.sizes[a.index()];
          changed.rate += self.rates[a.index()];
          if !self.asset_requests[a.index()].is_empty() {
            Rc::make_mut(&mut changed.loads).extend(self.asset_requests[a.index()].iter().copied());
          }
        }
      }
      host_states.push(changed);
      for &r in layout.references[source].iter() {
        if r != host && !next.references[host].contains(&r) {
          Rc::make_mut(&mut next.references[host]).push(r);
        }
      }
    }
    // Redirect a parent only to a host its consumers already load. Unredirected
    // parents keep the source alive, allowing selective duplication for request relief.
    for &parent in parents {
      let host = if hosts.contains(&parent) {
        parent
      } else {
        let Some(&host) = hosts.iter().find(|&&host| {
          state.consumers[parent].is_subset(&state.consumers[host])
            && !self.reaches(layout, &state.loads, host, Some(parent), scratch)
        }) else {
          continue;
        };
        host
      };
      let references = Rc::make_mut(&mut next.references[parent]);
      references.retain(|&r| r != source);
      if host != parent && !references.contains(&host) {
        references.push(host);
      }
    }
    // Protected sources only donate copies: they keep their payload and stay
    // live even when every parent was redirected, so lazy and URL resolutions
    // remain addressable.
    let still_referenced = self.protected.contains(source)
      || next
        .live
        .ones()
        .any(|b| next.references[b].contains(&source));
    next.live.set(source, still_referenced);
    let result = self.state_delta(&next, state, source, host_states, scratch);
    #[cfg(test)]
    if self.check_deltas {
      tests::assert_delta(self, &next, state, result.as_ref());
    }
    result.map(|changes| {
      let cost_change = changes.cost - state.cost;
      let relief = state.small + state.excess - changes.small - changes.excess;
      // Prefer the largest absolute saving when cost falls; otherwise choose
      // the lowest added cost per constraint violation removed.
      let score = if cost_change < 0.0 {
        cost_change
      } else {
        cost_change / relief as f64
      };
      Candidate {
        layout: next,
        changes,
        score,
      }
    })
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

  fn state_delta(
    &self,
    layout: &Layout,
    state: &State,
    source: usize,
    hosts: Vec<HostState>,
    scratch: &mut Scratch,
  ) -> Option<StateDelta> {
    scratch.host_indices.fill(usize::MAX);
    scratch.consumer_indices.fill(usize::MAX);
    scratch.changed.clear();
    for (index, host) in hosts.iter().enumerate() {
      scratch.host_indices[host.bundle] = index;
      scratch.changed.insert(host.bundle);
    }
    let mut delta = StateDelta {
      hosts,
      consumers: Vec::new(),
      roots: Vec::new(),
      costs: Vec::new(),
      excess: state.excess,
      small: state.small,
      cost: state.cost,
    };
    let mut fewer_requests = false;
    // Every changed host and referencing parent was already loaded by a
    // subset of the source's consumers. Other roots cannot encounter an edit.
    for root in state.consumers[source].ones() {
      scratch.seen.clear();
      scratch.stack.clear();
      scratch.stack.push(self.roots[root]);
      let mut requests = 0;
      let mut bytes = 0;
      while let Some(bundle) = scratch.stack.pop() {
        if !layout.live.contains(bundle) || scratch.seen.contains(bundle) {
          continue;
        }
        // Reject new downloads, including those introduced by copied assets.
        if !state.consumers[bundle].contains(root) {
          return None;
        }
        scratch.seen.insert(bundle);
        let host = scratch.host_indices[bundle];
        let (size, loads) = if host == usize::MAX {
          (state.sizes[bundle], &state.loads[bundle])
        } else {
          (delta.hosts[host].size, &delta.hosts[host].loads)
        };
        if self.bundles[bundle].bundle_behavior != BundleBehavior::Inline {
          requests += 1;
          bytes += size;
        }
        scratch
          .stack
          .extend(layout.references[bundle].iter().copied());
        scratch.stack.extend(loads.iter().copied());
      }
      // Overlapping hosts or a surviving source can duplicate downloads even
      // when no bundle gains a new consumer.
      if bytes > state.bytes[root] || requests > state.requests[root] {
        return None;
      }
      fewer_requests |= requests < state.requests[root];
      delta.excess -= self.request_excess(state.requests[root]);
      delta.excess += self.request_excess(requests);
      if requests != state.requests[root] || bytes != state.bytes[root] {
        delta.roots.push((root, requests, bytes));
      }
      // Retraversal handles alternate paths and cycles without reference-count
      // bookkeeping. Clone only consumer sets that actually lose a root.
      for (bundle, consumers) in state.consumers.iter().enumerate() {
        if consumers.contains(root) && !scratch.seen.contains(bundle) {
          let index = &mut scratch.consumer_indices[bundle];
          if *index == usize::MAX {
            *index = delta.consumers.len();
            delta.consumers.push((bundle, consumers.clone()));
            scratch.changed.insert(bundle);
          }
          delta.consumers[*index].1.set(root, false);
        }
      }
    }
    if !fewer_requests {
      return None;
    }
    scratch.costs.copy_from_slice(&state.costs);
    for bundle in scratch.changed.ones() {
      let old_count = state.consumers[bundle].count_ones(..);
      let index = scratch.consumer_indices[bundle];
      let count = if index == usize::MAX {
        old_count
      } else {
        delta.consumers[index].1.count_ones(..)
      };
      let host = scratch.host_indices[bundle];
      let (size, rate) = if host == usize::MAX {
        (state.sizes[bundle], state.rates[bundle])
      } else {
        (delta.hosts[host].size, delta.hosts[host].rate)
      };
      if self.undersized(bundle, state.sizes[bundle]) {
        delta.small -= old_count;
      }
      if self.undersized(bundle, size) {
        delta.small += count;
      }
      let cost = self.bundle_cost(size, rate, count);
      scratch.costs[bundle] = cost;
      delta.costs.push((bundle, cost));
    }
    if delta.small > state.small || delta.excess > state.excess {
      return None;
    }
    // Preserve full-state summation order: subtracting/adding costs can change
    // rounding enough to choose a different winner among near-equal candidates.
    delta.cost = scratch.costs.iter().sum();
    // Accept a move only when it strictly reduces the remaining violations or
    // strictly reduces cost; either alone qualifies, and neither may worsen.
    if delta.small + delta.excess >= state.small + state.excess
      && delta.cost >= state.cost - COST_EPSILON
    {
      return None;
    }
    Some(delta)
  }

  // One greedy pass to a fixed point over a shared candidate pool: donors under
  // request pressure or the size minimum, plus donors whose payload overlaps
  // another output. Scoring takes free cost reductions before cost-increasing
  // relief, so relief decisions always see deduplicated sizes. Every accepted
  // move strictly reduces total requests, bounding the loop.
  fn run(&self, mut layout: Layout, mut state: State) -> (Layout, State) {
    let mut scratch = Scratch::new(layout.live.len(), self.sizes.len());
    let mut seen = FixedBitSet::with_capacity(self.sizes.len());
    let mut duplicated = FixedBitSet::with_capacity(self.sizes.len());
    // Beyond the configured limits, a merge without overlap can only reduce
    // cost when the merged pair crosses the wire curve's warmup knee: below
    // it the curve is linear, where per-root bytes are unchanged while the
    // second-visit and invalidation terms of `bundle_cost` can only grow.
    // Deduplicating merges reduce cost under any monotone curve.
    let concave = !self.wire.is_linear();
    loop {
      seen.clear();
      duplicated.clear();
      for b in layout.live.ones() {
        for a in layout.assets[b].iter() {
          if seen.put(a.index()) {
            duplicated.insert(a.index());
          }
        }
      }
      // The two largest live payloads bound every donor's best possible
      // partner for the knee-crossing test.
      let mut max = [0usize; 2];
      if concave {
        for b in layout.live.ones() {
          let size = state.sizes[b];
          if size > max[0] {
            max = [size, max[0]];
          } else if size > max[1] {
            max[1] = size;
          }
        }
      }
      let mut sources: Vec<_> = layout
        .live
        .ones()
        .filter(|&b| {
          // Protected outputs may donate copies of their payload, but only to
          // relieve request pressure: the source bundle itself is never
          // changed or removed, so lazy and URL targets stay addressable.
          // Empty facades carry no payload and are never donors.
          if self.protected.contains(b) {
            return self.hosts.contains(b)
              && !layout.assets[b].is_empty()
              && state.consumers[b]
                .ones()
                .any(|r| self.request_excess(state.requests[r]) > 0);
          }
          let size = state.sizes[b];
          let partner = if size == max[0] { max[1] } else { max[0] };
          self.undersized(b, size)
            || state.consumers[b]
              .ones()
              .any(|r| self.request_excess(state.requests[r]) > 0)
            || (concave && (size + partner) as f64 > self.wire.w)
            || layout.assets[b]
              .iter()
              .any(|a| duplicated.contains(a.index()))
        })
        .collect();
      sources.sort_unstable_by_key(|&b| (state.sizes[b], self.bundles[b].id, b));
      let Some(candidate) = self.best_candidate(&layout, &state, &sources, &mut scratch) else {
        break;
      };
      layout = candidate.layout;
      candidate.changes.apply(&mut state);
    }
    (layout, state)
  }

  fn best_candidate(
    &self,
    layout: &Layout,
    state: &State,
    sources: &[usize],
    scratch: &mut Scratch,
  ) -> Option<Candidate> {
    let mut best: Option<Candidate> = None;
    for &source in sources {
      // This closure is identical for every host considered for this source.
      self.reaches(layout, &state.loads, source, None, scratch);
      // Copies must not reach roots that never loaded the source. Exclude
      // downstream hosts as well to avoid introducing reference cycles.
      let mut hosts: Vec<_> = layout
        .live
        .intersection(&self.hosts)
        .filter(|&h| {
          self.compatible(source, h)
            && !state.consumers[h].is_clear()
            && state.consumers[h].is_subset(&state.consumers[source])
            && !scratch.seen.contains(h)
        })
        .collect();
      if hosts.is_empty() {
        continue;
      }
      hosts.sort_unstable_by_key(|&h| (self.bundles[h].id, h));
      // Bundles referencing the source; identical for every cover tried below.
      let parents: Vec<_> = layout
        .live
        .ones()
        .filter(|&p| layout.references[p].contains(&source))
        .collect();
      // Full duplication fallback, then selective copies for request pressure.
      let direct: Vec<_> = hosts
        .iter()
        .copied()
        .filter(|&h| layout.references[h].contains(&source))
        .collect();
      let cover = self.greedy_cover(layout, state, source, &hosts, &mut scratch.assets);
      // Borrow singleton covers instead of allocating one Vec per host, and
      // skip exact repeats without changing the order of distinct candidates.
      let covers = std::iter::once(direct.as_slice())
        .chain((cover != direct).then_some(cover.as_slice()))
        .chain(
          hosts
            .iter()
            .filter(|&&h| direct.as_slice() != [h] && cover.as_slice() != [h])
            .map(std::slice::from_ref),
        );
      for cover in covers {
        let Some(candidate) = self.absorb(layout, state, source, cover, &parents, scratch) else {
          continue;
        };
        if best
          .as_ref()
          .is_none_or(|best| candidate.score < best.score)
        {
          best = Some(candidate);
        }
      }
    }
    best
  }

  fn greedy_cover(
    &self,
    layout: &Layout,
    state: &State,
    source: usize,
    hosts: &[usize],
    assets: &mut FixedBitSet,
  ) -> Vec<usize> {
    // Prices do not change as the remaining consumer set shrinks. A host
    // rejected here cannot become eligible later, so one sorted pass is
    // equivalent to repeatedly searching for the cheapest eligible host.
    let mut priced: Vec<_> = hosts
      .iter()
      .map(|&h| (h, self.host_price(layout, state, source, h, assets)))
      .collect();
    priced.sort_by(|&(a, a_price), &(b, b_price)| {
      a_price
        .total_cmp(&b_price)
        .then_with(|| self.bundles[a].id.cmp(&self.bundles[b].id))
    });
    let mut cover = Vec::new();
    let mut remaining = state.consumers[source].clone();
    for (host, _) in priced {
      if !state.consumers[host].is_subset(&remaining) {
        continue;
      }
      remaining.difference_with(&state.consumers[host]);
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
  fn host_price(
    &self,
    layout: &Layout,
    state: &State,
    source: usize,
    host: usize,
    assets: &mut FixedBitSet,
  ) -> f64 {
    set_asset_membership(assets, &layout.assets[host]);
    let mut added_size = 0;
    let mut added_rate = 0.0;
    for a in layout.assets[source].iter() {
      if !assets.contains(a.index()) {
        added_size += self.sizes[a.index()];
        added_rate += self.rates[a.index()];
      }
    }
    // Host consumer sets are never empty, so k is at least one.
    let k = state.consumers[host].count_ones(..);
    let before = self.bundle_cost(state.sizes[host], state.rates[host], k);
    let after = self.bundle_cost(
      state.sizes[host] + added_size,
      state.rates[host] + added_rate,
      k,
    );
    (after - before) / k as f64
  }
}
