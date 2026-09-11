//! Consolidate registration-only JS payloads without changing loading boundaries.
//! Consumer sets describe eager loading closures, not just direct references.
//! Every accepted move reduces requests without increasing downloaded bytes in any closure.

use std::rc::Rc;

use super::*;
use parcel_core::{AssetFlags, LogLevel};

#[cfg(test)]
#[path = "optimizer_tests.rs"]
mod tests;

#[derive(Clone)]
struct Layout {
  /// Asset placements by bundle index, shared between candidates until modified.
  assets: Vec<Rc<Vec<AssetIndex>>>,
  /// Explicit outgoing bundle references, shared between candidates until modified.
  references: Vec<Rc<Vec<usize>>>,
  /// Bundle indices still in the layout; removed slots remain until final compaction.
  live: FixedBitSet,
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
  /// Bundles that cannot donate their payloads, though some may still be hosts.
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
  if config.min_bundle_size == 0 && config.max_parallel_requests == 0 {
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
    let manual = bundle.assets.iter().chain(&bundle.entry_assets).any(|&a| {
      config
        .manual_shared_bundle(graph.asset(a), options)
        .is_some()
    });
    let can_host =
      bundle.ty == AssetType::Js && bundle.bundle_behavior == BundleBehavior::None && !manual;
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
  if protected.count_ones(..) == bundles.len()
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
  };
  let mut live = FixedBitSet::with_capacity(bundles.len());
  live.insert_range(..);
  let initial = Layout {
    assets: bundles.iter().map(|b| Rc::new(b.assets.clone())).collect(),
    references: bundles
      .iter()
      .map(|b| Rc::new(b.referenced_bundles.clone()))
      .collect(),
    live,
  };
  let initial_state = model.state(&initial);
  if initial_state.small == 0 && initial_state.excess == 0 {
    return Ok(());
  }

  let (mut chosen, result) = model.run_guarded(initial);
  if result.excess > 0 || result.small > 0 {
    options.reporters.log(LogLevel::Warn, &format!(
      "Bundle consolidation left {} excess requests and {} undersized shared-bundle occurrences; no further safe merge was found.",
      result.excess, result.small
    ));
  }

  // Keep the original DFS packaging order, including after multiple moves.
  let mut order = vec![usize::MAX; graph.assets.len()];
  for (rank, (a, _, _)) in graph.dfs().enumerate() {
    order[a.index()] = rank;
  }
  let mut remap = vec![usize::MAX; bundles.len()];
  let mut next = 0;
  for i in chosen.live.ones() {
    remap[i] = next;
    next += 1;
  }
  let mut output = Vec::with_capacity(next);
  for (i, mut bundle) in std::mem::take(bundles).into_iter().enumerate() {
    if !chosen.live.contains(i) {
      continue;
    }
    bundle.assets = Rc::unwrap_or_clone(std::mem::take(&mut chosen.assets[i]));
    bundle.assets.sort_by_key(|a| order[a.index()]);
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
  fn run_guarded(&self, initial: Layout) -> (Layout, State) {
    let baseline = self.run(initial.clone(), false);
    let optimized = self.run(initial, true);
    // Keep a smallest-first fallback using only protected hosts: scoring more
    // candidates can lead to a worse final layout. Compare completed runs by
    // constraint violations first, then cost, rather than trusting local choices.
    if (optimized.1.excess, optimized.1.small) < (baseline.1.excess, baseline.1.small)
      || ((optimized.1.excess, optimized.1.small) == (baseline.1.excess, baseline.1.small)
        && optimized.1.cost < baseline.1.cost - 1e-6)
    {
      optimized
    } else {
      baseline
    }
  }

  // Full evaluation initializes each run and is the test oracle for state_delta.
  fn state(&self, layout: &Layout) -> State {
    let n = self.roots.len();
    let mut consumers = vec![FixedBitSet::with_capacity(n); layout.live.len()];
    let mut requests = vec![0usize; n];
    let mut bytes = vec![0; n];
    // Scan each asset list once per state, rather than once per loading root.
    // Most assets have no eager bundle dependencies, so keep those edges in a
    // flat buffer instead of allocating a separate adjacency list per bundle.
    let mut sizes = Vec::with_capacity(layout.assets.len());
    let mut rates = Vec::with_capacity(layout.assets.len());
    let mut load_offsets = Vec::with_capacity(layout.assets.len() + 1);
    let mut loads = Vec::new();
    load_offsets.push(0);
    for assets in &layout.assets {
      let mut size = 0;
      let mut rate = 0.0;
      for a in assets.iter() {
        size += self.sizes[a.index()];
        rate += self.rates[a.index()];
        loads.extend(self.asset_requests[a.index()].iter().copied());
      }
      sizes.push(size);
      rates.push(rate);
      load_offsets.push(loads.len());
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
        stack.extend(loads[load_offsets[b]..load_offsets[b + 1]].iter().copied());
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
      if !self.protected.contains(b) && sizes[b] < self.config.min_bundle_size {
        small += k;
      }
      // Assume a uniformly chosen first root and optionally a different second
      // root. `second` counts a cache miss only on that second visit; invalidation
      // adds the expected download after one edit, weighted by asset change rates.
      let probability = k as f64 / n as f64;
      let second = if n > 1 {
        ((n - k) * k) as f64 / (n * (n - 1)) as f64
      } else {
        0.0
      };
      let invalidation = if self.total_rate > 0.0 {
        probability * rates[b] / self.total_rate
      } else {
        0.0
      };
      costs[b] = sizes[b] as f64
        * (probability + (1.0 - self.config.first_page_load_priority) * second + invalidation);
      cost += costs[b];
    }
    let excess = if self.config.max_parallel_requests == 0 {
      0
    } else {
      requests
        .iter()
        .map(|n| n.saturating_sub(self.config.max_parallel_requests))
        .sum()
    };
    let empty_loads = Rc::new(Vec::new());
    State {
      consumers,
      requests,
      bytes,
      sizes,
      rates,
      loads: load_offsets
        .windows(2)
        .map(|range| {
          if range[0] == range[1] {
            empty_loads.clone()
          } else {
            Rc::new(loads[range[0]..range[1]].to_vec())
          }
        })
        .collect(),
      costs,
      excess,
      small,
      cost,
    }
  }

  fn compatible(&self, source: usize, host: usize) -> bool {
    source != host
      && self.hosts.contains(host)
      && self.packagers[source] == self.packagers[host]
      && self.bundles[source].target == self.bundles[host].target
  }

  // With no target, collect the entire closure for host filtering. With a
  // target, stop early when checking whether redirecting an edge makes a cycle.
  fn reaches(
    &self,
    layout: &Layout,
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
      for a in layout.assets[b].iter() {
        scratch
          .stack
          .extend(self.asset_requests[a.index()].iter().copied());
      }
    }
    false
  }

  fn absorb(
    &self,
    layout: &Layout,
    state: &State,
    source: usize,
    hosts: &[usize],
    scratch: &mut Scratch,
  ) -> Option<(Layout, StateDelta)> {
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
      scratch.assets.clear();
      scratch
        .assets
        .extend(layout.assets[host].iter().map(|a| a.index()));
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
    for parent in layout.live.ones() {
      if !layout.references[parent].contains(&source) {
        continue;
      }
      if hosts.contains(&parent) {
        Rc::make_mut(&mut next.references[parent]).retain(|&r| r != source);
      } else if let Some(&host) = hosts.iter().find(|&&host| {
        state.consumers[parent].is_subset(&state.consumers[host])
          && !self.reaches(layout, host, Some(parent), scratch)
      }) {
        Rc::make_mut(&mut next.references[parent]).retain(|&r| r != source);
        if !next.references[parent].contains(&host) {
          Rc::make_mut(&mut next.references[parent]).push(host);
        }
      }
    }
    let still_referenced = next
      .live
      .ones()
      .any(|b| next.references[b].contains(&source));
    next.live.set(source, still_referenced);
    let result = self.state_delta(&next, state, source, host_states, scratch);
    #[cfg(test)]
    if self.check_deltas {
      tests::assert_delta(self, &next, state, result.as_ref());
    }
    result.map(|delta| (next, delta))
  }

  fn bundle_cost(&self, size: usize, rate: f64, consumers: usize) -> f64 {
    if consumers == 0 {
      return 0.0;
    }
    let n = self.roots.len();
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
    size as f64
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
      if !self.protected.contains(bundle) {
        if state.sizes[bundle] < self.config.min_bundle_size {
          delta.small -= old_count;
        }
        if size < self.config.min_bundle_size {
          delta.small += count;
        }
      }
      let cost = self.bundle_cost(size, rate, count);
      scratch.costs[bundle] = cost;
      delta.costs.push((bundle, cost));
    }
    if delta.small > state.small
      || delta.excess > state.excess
      || delta.small + delta.excess >= state.small + state.excess
    {
      return None;
    }
    // Preserve full-state summation order: subtracting/adding costs can change
    // rounding enough to choose a different winner among near-equal candidates.
    delta.cost = scratch.costs.iter().fold(0.0, |sum, cost| sum + cost);
    Some(delta)
  }

  fn run(&self, mut layout: Layout, scored: bool) -> (Layout, State) {
    let mut state = self.state(&layout);
    if state.small == 0 && state.excess == 0 {
      return (layout, state);
    }
    let mut scratch = Scratch::new(layout.live.len(), self.sizes.len());
    loop {
      if state.small == 0 && state.excess == 0 {
        break;
      }
      let mut sources: Vec<_> = layout
        .live
        .difference(&self.protected)
        .filter(|&b| {
          state.sizes[b] < self.config.min_bundle_size
            || (self.config.max_parallel_requests > 0
              && state.consumers[b]
                .ones()
                .any(|r| state.requests[r] > self.config.max_parallel_requests))
        })
        .collect();
      sources.sort_unstable_by_key(|&b| (state.sizes[b], self.bundles[b].id, b));
      let mut best: Option<(Layout, StateDelta, f64)> = None;
      for source in sources {
        // This closure is identical for every host considered for this source.
        self.reaches(&layout, source, None, &mut scratch);
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
              && (scored || self.protected.contains(h))
          })
          .collect();
        hosts.sort_unstable_by_key(|&h| (self.bundles[h].id, h));
        // Full duplication fallback, then selective copies for request pressure.
        let direct: Vec<_> = hosts
          .iter()
          .copied()
          .filter(|&h| layout.references[h].contains(&source))
          .collect();
        let mut cover = Vec::new();
        if scored {
          // Prices do not change as the remaining consumer set shrinks. A host
          // rejected here cannot become eligible later, so one sorted pass is
          // equivalent to repeatedly searching for the cheapest eligible host.
          let mut priced: Vec<_> = hosts
            .iter()
            .map(|&h| {
              (
                h,
                self.host_price(&layout, &state, source, h, &mut scratch.assets),
              )
            })
            .collect();
          priced.sort_by(|&(a, a_price), &(b, b_price)| {
            a_price
              .total_cmp(&b_price)
              .then_with(|| self.bundles[a].id.cmp(&self.bundles[b].id))
          });
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
        }
        // Borrow singleton covers instead of allocating one Vec per host, and
        // skip exact repeats without changing the order of distinct candidates.
        let covers = std::iter::once(direct.as_slice())
          .chain((scored && cover != direct).then_some(cover.as_slice()))
          .chain(
            hosts
              .iter()
              .filter(|&&h| direct.as_slice() != [h] && cover.as_slice() != [h])
              .map(std::slice::from_ref),
          );
        for cover in covers {
          let Some((next, result)) = self.absorb(&layout, &state, source, cover, &mut scratch)
          else {
            continue;
          };
          let delta = result.cost - state.cost;
          let relief = state.small + state.excess - result.small - result.excess;
          // Prefer the largest absolute saving when cost falls; otherwise choose
          // the lowest added cost per constraint violation removed.
          let score = delta / if delta < 0.0 { 1.0 } else { relief as f64 };
          if best.as_ref().is_none_or(|(_, _, current)| score < *current) {
            best = Some((next, result, score));
          }
          if !scored {
            break;
          }
        }
        if !scored && best.is_some() {
          break;
        }
      }
      let Some((next, result, _)) = best else {
        break;
      };
      layout = next;
      result.apply(&mut state);
    }
    (layout, state)
  }

  // Estimate added cost per host consumer to construct a cover. The complete
  // candidate is then evaluated exactly, including whether the source survives.
  fn host_price(
    &self,
    layout: &Layout,
    state: &State,
    source: usize,
    host: usize,
    assets: &mut FixedBitSet,
  ) -> f64 {
    assets.clear();
    assets.extend(layout.assets[host].iter().map(|a| a.index()));
    let mut added_size = 0;
    let mut added_rate = 0.0;
    for a in layout.assets[source].iter() {
      if !assets.contains(a.index()) {
        added_size += self.sizes[a.index()];
        added_rate += self.rates[a.index()];
      }
    }
    let host_rate = state.rates[host];
    let n = self.roots.len();
    let k = state.consumers[host].count_ones(..);
    let navigation = if n > 1 {
      (n - k) as f64 / (n - 1) as f64
    } else {
      0.0
    };
    let cache = if self.total_rate > 0.0 {
      (added_size as f64 * (host_rate + added_rate) + state.sizes[host] as f64 * added_rate)
        / self.total_rate
    } else {
      0.0
    };
    added_size as f64 * (1.0 + (1.0 - self.config.first_page_load_priority) * navigation) + cache
  }
}
