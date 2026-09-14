//! Per-context CSS application order, and a bundle plan that preserves it.
//!
//! Cascade order is semantic in CSS, so a bundle partition is only correct if
//! every bundle's internal order agrees with all of its consumers and each
//! bundle's assets are contiguous in every consumer's order. Stylesheets that
//! consumers order inconsistently are duplicated per consumer instead, which
//! is always order-correct because each context positions its own copy.

use std::collections::HashSet;

use parcel_core::AssetFlags;

use super::*;
use crate::bundler::reachability::synchronous_dependencies;

/// A planned CSS bundle: its assets in application order, and the identity
/// seed used for a stable bundle id.
pub(super) struct Segment {
  pub assets: Vec<AssetIndex>,
  /// For a per-root duplicate, the owning root index; shared segments None.
  pub owner_root: Option<usize>,
  /// Position among the segments split from the same group. Bundle identity
  /// derives from (consumer roots, packager, ordinal, owner) so names stay
  /// stable when a segment's membership changes.
  pub ordinal: usize,
  /// A stylesheet root bundle this segment joins (the reused-bundle pattern
  /// for CSS). Only the segment that immediately precedes the root asset in
  /// every consumer's sequence may join it: the root bundle loads at the
  /// root's own (last) position, so any other segment placed inside it would
  /// apply after content it must precede.
  pub bind_to: Option<AssetIndex>,
}

pub(super) struct StylePlan {
  /// Planned placements per CSS asset, in segment-index order.
  pub slots: HashMap<AssetIndex, Vec<u32>>,
  pub segments: Vec<Segment>,
  /// Per root index: that root's planned segments in application order.
  pub root_order: Vec<Vec<u32>>,
  /// Assets duplicated because consumers disagreed about their order.
  pub conflicts: Vec<AssetIndex>,
}

/// Compute per-root CSS application order and the resulting bundle plan.
/// `plannable` excludes assets whose grouping is fixed elsewhere (manual
/// bundles); they still take part in ordering as opaque neighbors.
pub(super) fn plan(
  asset_graph: &AssetGraph,
  bundle_roots: &BundleRoots,
  needed_roots: &Reachability,
  plannable: impl Fn(&Asset) -> bool,
) -> StylePlan {
  let (sequences, scoped) = sequences(asset_graph, bundle_roots, needed_roots);

  // Group plannable assets by (consumer root set, packager) like BundleKey
  // does: distinct classes whose root sets collapsed together during
  // availability still share one bundle. First appearance order across roots
  // keeps group numbering deterministic.
  let mut group_ids: HashMap<(&FixedBitSet, ContentType), usize> = HashMap::new();
  let mut group_of: HashMap<AssetIndex, usize> = HashMap::new();
  let mut group_count = 0;
  for sequence in &sequences {
    for &asset_index in sequence {
      let asset = asset_graph.asset(asset_index);
      // Bundle-root stylesheets stay on the legacy path: their bundles carry
      // loading, entry, and mirroring semantics (CSS entry cycles mirror one
      // bundle per entry). Planned classmates join them via slot binding.
      if group_of.contains_key(&asset_index)
        || bundle_roots.is_bundle_root(asset_index)
        || !plannable(asset)
      {
        continue;
      }
      let key = (
        needed_roots.reachable_roots(asset_index),
        asset.content.ty(),
      );
      let group = *group_ids.entry(key).or_insert_with(|| {
        group_count += 1;
        group_count - 1
      });
      group_of.insert(asset_index, group);
    }
  }

  let bindable = |root_asset: AssetIndex, member: AssetIndex, owner: Option<usize>| -> bool {
    if !bundle_roots.is_bundle_root(root_asset) {
      return false;
    }
    let root = asset_graph.asset(root_asset);
    if root.ty != AssetType::Css || root.content.ty() != asset_graph.asset(member).content.ty() {
      return false;
    }
    let reach = needed_roots.reachable_roots(root_asset);
    match owner {
      // A shared segment joins a root bundle loaded in exactly its contexts.
      None => reach == needed_roots.reachable_roots(member),
      // An owned copy joins a root bundle loaded only in the owning context.
      Some(owner) => reach.count_ones(..) == 1 && reach.contains(owner),
    }
  };

  segment(&sequences, &group_of, &scoped, &bindable)
}

/// Application order of the CSS assets each root loads, derived from the same
/// synchronous edges as reachability classes. Emission is postorder (imports
/// before their importer), deduplicated so the last occurrence wins, matching
/// browser semantics for repeated imports and the packager's inline order.
///
/// Also returns `(root, asset)` pairs that must stay in one file for that
/// root: a sheet with pre-import `@layer` statements establishes layer order
/// ahead of its whole import closure, which no arrangement of multiple links
/// can reproduce, so the sheet and its subtree run are privatized per root.
fn sequences(
  asset_graph: &AssetGraph,
  bundle_roots: &BundleRoots,
  needed_roots: &Reachability,
) -> (Vec<Vec<AssetIndex>>, HashSet<(usize, AssetIndex)>) {
  // Restrict traversal to subgraphs that can reach a stylesheet. The sync
  // graph can contain cycles, so iterate to a fixed point; reverse DFS order
  // resolves almost everything in the first pass.
  let dfs: Vec<(AssetIndex, &Asset)> = asset_graph.dfs().map(|(i, a, _)| (i, a)).collect();
  let mut has_style = FixedBitSet::with_capacity(asset_graph.assets.len());
  loop {
    let mut changed = false;
    for (asset_index, asset) in dfs.iter().rev() {
      if has_style.contains(asset_index.index()) {
        continue;
      }
      let style = asset.ty == AssetType::Css
        || synchronous_dependencies(asset_graph, bundle_roots, asset)
          .any(|target| has_style.contains(target.index()));
      if style {
        has_style.insert(asset_index.index());
        changed = true;
      }
    }
    if !changed {
      break;
    }
  }

  // Whether an asset's import closure declares any cascade layer: its own
  // content does (DECLARES_LAYERS), one of its import sites adds a layer
  // clause, or a child's closure declares one. A repeated import of such a
  // closure declares those layers at its FIRST occurrence, even though its
  // content keeps the last.
  let layer_count = |index: AssetIndex| {
    asset_graph
      .asset(index)
      .target
      .style_condition
      .as_ref()
      .map_or(0, |c| c.layers.len())
  };
  let mut declares = FixedBitSet::with_capacity(asset_graph.assets.len());
  loop {
    let mut changed = false;
    for (asset_index, asset) in dfs.iter().rev() {
      if declares.contains(asset_index.index()) {
        continue;
      }
      let value = asset.flags.contains(AssetFlags::DECLARES_LAYERS)
        || synchronous_dependencies(asset_graph, bundle_roots, asset).any(|target| {
          asset_graph.asset(target).ty == AssetType::Css
            && (declares.contains(target.index())
              || layer_count(target) > layer_count(*asset_index))
        });
      if value {
        declares.insert(asset_index.index());
        changed = true;
      }
    }
    if !changed {
      break;
    }
  }

  let mut sequences = vec![Vec::new(); bundle_roots.len()];
  let mut scoped = HashSet::new();
  let mut position = vec![usize::MAX; asset_graph.assets.len()];
  let mut seen = FixedBitSet::with_capacity(asset_graph.assets.len());
  let mut entries = Vec::new();
  let mut out = Vec::new();
  let mut runs = Vec::new();
  for (root_index, root_asset) in bundle_roots.iter_active() {
    if !has_style.contains(root_asset.index()) {
      continue;
    }
    // Phase 1: JS execution order. A module runs once, at its first import,
    // so stylesheet entry points dedupe keeping the FIRST occurrence.
    seen.clear();
    entries.clear();
    collect_entries(
      asset_graph,
      bundle_roots,
      &has_style,
      root_asset,
      &mut seen,
      &mut entries,
    );
    // Phase 2: expand @import subtrees. Browsers apply every @import
    // instance, so a repeated sheet takes its LAST position; walking entries
    // and imports reversed with first-occurrence dedup, then reversing,
    // yields exactly that order.
    seen.clear();
    out.clear();
    runs.clear();
    position.fill(usize::MAX);
    for &entry in entries.iter().rev() {
      css_reverse_walk(
        asset_graph,
        bundle_roots,
        needed_roots,
        &declares,
        root_index,
        entry,
        &mut seen,
        &mut out,
        &mut position,
        &mut runs,
      );
    }
    // A statement-scoped run of more than the sheet itself must load as one
    // unit; a lone sheet already carries its statements in its own file.
    for &(start, end) in &runs {
      if end - start > 1 {
        for &asset in &out[start..end] {
          scoped.insert((root_index, asset));
        }
      }
    }
    out.reverse();
    sequences[root_index] = out.clone();
  }
  (sequences, scoped)
}

/// Stylesheet entry points in JS execution order (first import wins).
fn collect_entries(
  asset_graph: &AssetGraph,
  bundle_roots: &BundleRoots,
  has_style: &FixedBitSet,
  asset_index: AssetIndex,
  seen: &mut FixedBitSet,
  entries: &mut Vec<AssetIndex>,
) {
  if seen.put(asset_index.index()) {
    return;
  }
  let asset = asset_graph.asset(asset_index);
  if asset.ty == AssetType::Css {
    entries.push(asset_index);
    return;
  }
  for target in synchronous_dependencies(asset_graph, bundle_roots, asset) {
    if has_style.contains(target.index()) {
      collect_entries(asset_graph, bundle_roots, has_style, target, seen, entries);
    }
  }
}

fn css_reverse_walk(
  asset_graph: &AssetGraph,
  bundle_roots: &BundleRoots,
  needed_roots: &Reachability,
  declares: &FixedBitSet,
  root_index: usize,
  asset_index: AssetIndex,
  seen: &mut FixedBitSet,
  out: &mut Vec<AssetIndex>,
  position: &mut Vec<usize>,
  runs: &mut Vec<(usize, usize)>,
) {
  if seen.put(asset_index.index()) {
    return;
  }
  let asset = asset_graph.asset(asset_index);
  let start = out.len();
  let pushed = needed_roots
    .reachable_roots(asset_index)
    .contains(root_index);
  if pushed {
    position[asset_index.index()] = out.len();
    out.push(asset_index);
  }
  let layer_count = |index: AssetIndex| {
    asset_graph
      .asset(index)
      .target
      .style_condition
      .as_ref()
      .map_or(0, |c| c.layers.len())
  };
  let children: Vec<AssetIndex> = synchronous_dependencies(asset_graph, bundle_roots, asset)
    .filter(|target| asset_graph.asset(*target).ty == AssetType::Css)
    .collect();
  for target in children.into_iter().rev() {
    if seen.contains(target.index()) {
      // A repeated import: the kept (last) instance holds the content
      // position, but this earlier instance still declares any layers in
      // its closure here. The declaration matters only when content BETWEEN
      // this site and the kept instance declares layers of its own — then
      // the span, including this importer (whose prefix holds the site),
      // must stay in one file for this root so the packager can emit the
      // first-occurrence declaration in place.
      if declares.contains(target.index()) || layer_count(target) > layer_count(asset_index) {
        let kept = position[target.index()];
        if kept != usize::MAX
          && out[kept + 1..]
            .iter()
            .any(|a| declares.contains(a.index()) || layer_count(*a) > 0)
        {
          runs.push((kept.min(position[asset_index.index()]), out.len()));
        }
      }
      continue;
    }
    css_reverse_walk(
      asset_graph,
      bundle_roots,
      needed_roots,
      declares,
      root_index,
      target,
      seen,
      out,
      position,
      runs,
    );
  }
  // The walk is reversed, so a sheet and the part of its import subtree that
  // takes its position here occupy `out[start..]` contiguously — the closure
  // a pre-import @layer statement governs. (Subtree members claimed by a
  // later importer sit outside the range; the statement precedes them
  // regardless of file placement.)
  if pushed
    && asset
      .flags
      .contains(AssetFlags::PRE_IMPORT_LAYER_STATEMENTS)
  {
    runs.push((start, out.len()));
  }
}

/// Partition grouped assets into ordered segments that every consumer can
/// emit contiguously, duplicating order-conflicted assets per consumer.
/// `scoped` names `(root, asset)` pairs that root must load privately (layer
/// statement closures); a scoped root takes a private copy of the asset's
/// whole group. `bindable` decides whether a segment adjacent to a stylesheet
/// root asset may join that root's bundle.
fn segment(
  sequences: &[Vec<AssetIndex>],
  group_of: &HashMap<AssetIndex, usize>,
  scoped: &HashSet<(usize, AssetIndex)>,
  bindable: &dyn Fn(AssetIndex, AssetIndex, Option<usize>) -> bool,
) -> StylePlan {
  // Positions per root for interleave checks and order comparison.
  let positions: Vec<HashMap<AssetIndex, usize>> = sequences
    .iter()
    .map(|s| s.iter().enumerate().map(|(i, &a)| (a, i)).collect())
    .collect();

  // Group members in reference order (first consuming root's order), and the
  // consuming roots per group.
  let mut members: Vec<Vec<AssetIndex>> = Vec::new();
  let mut consumers: Vec<Vec<usize>> = Vec::new();
  for (root, sequence) in sequences.iter().enumerate() {
    let mut seen_groups = HashSet::new();
    for &asset in sequence {
      let Some(&group) = group_of.get(&asset) else {
        continue;
      };
      while members.len() <= group {
        members.push(Vec::new());
        consumers.push(Vec::new());
      }
      if members[group].is_empty() || !members[group].contains(&asset) {
        members[group].push(asset);
      }
      if seen_groups.insert(group) {
        consumers[group].push(root);
      }
    }
  }

  let mut plan = StylePlan {
    slots: HashMap::new(),
    segments: Vec::new(),
    root_order: vec![Vec::new(); sequences.len()],
    conflicts: Vec::new(),
  };
  // Roots that take a private copy of a whole group. A scoped pair (a layer
  // statement's closure) privatizes the group for that root only; an order
  // conflict privatizes it for every consumer, because successive lazy
  // activations share one document and a partially shared group already
  // loaded at an incompatible position could not be reordered. With full
  // copies, each activation re-asserts its own order and the last one wins,
  // deterministically, as per-link markup would behave natively.
  let mut owners: Vec<HashSet<usize>> = vec![HashSet::new(); members.len()];
  for &(root, asset) in scoped {
    if let Some(&group) = group_of.get(&asset) {
      owners[group].insert(root);
    }
  }
  let mut slot_consumers: Vec<Vec<usize>> = Vec::new();
  let mut owned_pairs: HashSet<(usize, AssetIndex)> = HashSet::new();

  for (group, members) in members.iter().enumerate() {
    let owners = &mut owners[group];
    let mut shared: Vec<usize> = consumers[group]
      .iter()
      .copied()
      .filter(|c| !owners.contains(c))
      .collect();
    // Reference order and conflict detection among the remaining sharers.
    let mut ordered = members.clone();
    if let Some(&reference) = shared.first() {
      ordered.sort_by_key(|a| positions[reference].get(a).copied());
      let conflicting = shared[1..].iter().any(|&consumer| {
        let positions = &positions[consumer];
        let order: Vec<usize> = ordered
          .iter()
          .filter_map(|a| positions.get(a).copied())
          .collect();
        order.len() == ordered.len() && !order.is_sorted()
      });
      if conflicting {
        plan.conflicts.extend(ordered.iter().copied());
        owners.extend(shared.drain(..));
      }
    }
    for &owner in owners.iter() {
      owned_pairs.extend(members.iter().map(|&m| (owner, m)));
    }
    if shared.is_empty() {
      continue;
    }

    // Split wherever any sharing consumer interleaves something between
    // neighbors.
    let mut ordinal = 0;
    let mut current: Vec<AssetIndex> = Vec::new();
    for (i, &asset) in ordered.iter().enumerate() {
      if i > 0 {
        let previous = ordered[i - 1];
        let split =
          shared.iter().any(
            |&c| match (positions[c].get(&previous), positions[c].get(&asset)) {
              (Some(&p), Some(&q)) => q > p + 1,
              _ => true,
            },
          );
        if split {
          push_segment(
            &mut plan,
            &mut slot_consumers,
            std::mem::take(&mut current),
            None,
            ordinal,
            shared.clone(),
          );
          ordinal += 1;
        }
      }
      current.push(asset);
    }
    push_segment(
      &mut plan,
      &mut slot_consumers,
      current,
      None,
      ordinal,
      shared,
    );
  }

  // Duplicate owned assets per owning root, coalescing runs that are
  // adjacent in that root's sequence into one bundle.
  for (root, sequence) in sequences.iter().enumerate() {
    let mut ordinal = 0;
    let mut run: Vec<AssetIndex> = Vec::new();
    let mut last_position = 0;
    for (position, &asset) in sequence.iter().enumerate() {
      if owned_pairs.contains(&(root, asset)) {
        if !run.is_empty() && position != last_position + 1 {
          push_segment(
            &mut plan,
            &mut slot_consumers,
            std::mem::take(&mut run),
            Some(root),
            ordinal,
            vec![root],
          );
          ordinal += 1;
        }
        run.push(asset);
        last_position = position;
      }
    }
    if !run.is_empty() {
      push_segment(
        &mut plan,
        &mut slot_consumers,
        run,
        Some(root),
        ordinal,
        vec![root],
      );
    }
  }

  // Bind the segment that immediately precedes the same stylesheet root
  // asset in every consumer's sequence into that root's bundle.
  for (slot, segment) in plan.segments.iter_mut().enumerate() {
    let last = *segment.assets.last().unwrap();
    let mut next = slot_consumers[slot].iter().map(|&c| {
      positions[c]
        .get(&last)
        .and_then(|&p| sequences[c].get(p + 1))
        .copied()
    });
    if let Some(Some(root_asset)) = next.next() {
      if next.all(|n| n == Some(root_asset)) && bindable(root_asset, last, segment.owner_root) {
        segment.bind_to = Some(root_asset);
      }
    }
  }

  // Application order of planned segments per root. An owning root uses its
  // own copy of an asset; other roots use the shared placement.
  for (root, sequence) in sequences.iter().enumerate() {
    let mut order = Vec::new();
    for &asset in sequence {
      let Some(slots) = plan.slots.get(&asset) else {
        continue;
      };
      let owned = owned_pairs.contains(&(root, asset));
      for &slot in slots {
        let matches = match plan.segments[slot as usize].owner_root {
          Some(owner) => owned && owner == root,
          None => !owned,
        };
        if matches && !order.contains(&slot) {
          order.push(slot);
        }
      }
    }
    plan.root_order[root] = order;
  }

  plan.conflicts.sort_unstable_by_key(|a| a.index());
  plan.conflicts.dedup();
  plan
}

fn push_segment(
  plan: &mut StylePlan,
  slot_consumers: &mut Vec<Vec<usize>>,
  assets: Vec<AssetIndex>,
  owner_root: Option<usize>,
  ordinal: usize,
  consumers: Vec<usize>,
) {
  if assets.is_empty() {
    return;
  }
  let slot = plan.segments.len() as u32;
  for &asset in &assets {
    plan.slots.entry(asset).or_default().push(slot);
  }
  plan.segments.push(Segment {
    assets,
    owner_root,
    ordinal,
    bind_to: None,
  });
  slot_consumers.push(consumers);
}

#[cfg(test)]
mod tests {
  use super::*;

  fn a(i: u32) -> AssetIndex {
    AssetIndex(i)
  }

  fn run(sequences: Vec<Vec<u32>>, groups: Vec<(u32, usize)>) -> StylePlan {
    run_full(sequences, groups, vec![], &|_, _, _| false)
  }

  fn run_full(
    sequences: Vec<Vec<u32>>,
    groups: Vec<(u32, usize)>,
    scoped: Vec<(usize, u32)>,
    bindable: &dyn Fn(AssetIndex, AssetIndex, Option<usize>) -> bool,
  ) -> StylePlan {
    let sequences: Vec<Vec<AssetIndex>> = sequences
      .into_iter()
      .map(|s| s.into_iter().map(a).collect())
      .collect();
    let group_of = groups.into_iter().map(|(asset, g)| (a(asset), g)).collect();
    let scoped = scoped
      .into_iter()
      .map(|(root, asset)| (root, a(asset)))
      .collect();
    segment(&sequences, &group_of, &scoped, bindable)
  }

  fn segment_assets(plan: &StylePlan) -> Vec<(Vec<u32>, Option<usize>)> {
    plan
      .segments
      .iter()
      .map(|s| (s.assets.iter().map(|a| a.0).collect(), s.owner_root))
      .collect()
  }

  #[test]
  fn consistent_orders_share_one_segment() {
    let plan = run(
      vec![vec![1, 2, 3], vec![1, 2, 3]],
      vec![(1, 0), (2, 0), (3, 0)],
    );
    assert_eq!(segment_assets(&plan), vec![(vec![1, 2, 3], None)]);
    assert_eq!(plan.root_order, vec![vec![0], vec![0]]);
    assert!(plan.conflicts.is_empty());
  }

  #[test]
  fn conflicting_orders_duplicate_per_root() {
    // Root 0 loads x then y; root 1 loads y then x. The whole group is
    // duplicated per root: a partially shared group cannot satisfy both
    // orders once the shared part is loaded at an incompatible position by
    // an earlier lazy activation.
    let plan = run(vec![vec![1, 2], vec![2, 1]], vec![(1, 0), (2, 0)]);
    assert_eq!(plan.conflicts.len(), 2);
    assert!(plan.segments.iter().all(|s| s.owner_root.is_some()));
    assert_eq!(plan.segments.len(), 2);
    // Each root's order follows its own sequence via its own copies.
    for (root, sequence) in [vec![1, 2], vec![2, 1]].iter().enumerate() {
      let emitted: Vec<u32> = plan.root_order[root]
        .iter()
        .flat_map(|&slot| plan.segments[slot as usize].assets.iter().map(|a| a.0))
        .collect();
      assert_eq!(&emitted, sequence);
    }
  }

  #[test]
  fn interleaved_foreign_assets_split_segments() {
    // Root 0: a1, shared, a2. Root 1: shared only. Group 0 = {a1, a2},
    // group 1 = {shared}; a1 and a2 cannot be one bundle for root 0.
    let plan = run(vec![vec![1, 9, 2], vec![9]], vec![(1, 0), (2, 0), (9, 1)]);
    assert_eq!(
      segment_assets(&plan),
      vec![(vec![1], None), (vec![2], None), (vec![9], None)]
    );
    assert_eq!(plan.root_order[0], vec![0, 2, 1]);
    assert_eq!(plan.root_order[1], vec![2]);
  }

  #[test]
  fn statement_scope_privatizes_group_per_root() {
    // Root 0's sequence begins with a layer-statement closure covering the
    // shared sheet 9 and its own sheet 1, so root 0 takes a private coalesced
    // copy; root 1 keeps sharing 9 with nobody else affected.
    let plan = run_full(
      vec![vec![9, 1], vec![9]],
      vec![(9, 0), (1, 1)],
      vec![(0, 9), (0, 1)],
      &|_, _, _| false,
    );
    let owned: Vec<_> = plan
      .segments
      .iter()
      .filter(|s| s.owner_root == Some(0))
      .collect();
    assert_eq!(owned.len(), 1);
    assert_eq!(owned[0].assets, vec![a(9), a(1)]);
    let shared: Vec<_> = plan
      .segments
      .iter()
      .filter(|s| s.owner_root.is_none())
      .collect();
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0].assets, vec![a(9)]);
    // Each root emits exactly its own sequence through its own placements.
    for (root, sequence) in [vec![9, 1], vec![9]].iter().enumerate() {
      let emitted: Vec<u32> = plan.root_order[root]
        .iter()
        .flat_map(|&slot| plan.segments[slot as usize].assets.iter().map(|a| a.0))
        .collect();
      assert_eq!(&emitted, sequence);
    }
    assert!(plan.conflicts.is_empty());
  }

  #[test]
  fn only_adjacent_segment_binds_to_root() {
    // Root 0: own sheets 1 and 2 interleaved around shared sheet 9, then the
    // stylesheet root asset 5. Only the segment ending immediately before 5
    // may join 5's bundle; binding an earlier segment would load it last.
    let plan = run_full(
      vec![vec![1, 9, 2, 5], vec![9]],
      vec![(1, 0), (2, 0), (9, 1)],
      vec![],
      &|root_asset, _, _| root_asset == a(5),
    );
    for segment in &plan.segments {
      if segment.assets == vec![a(2)] {
        assert_eq!(segment.bind_to, Some(a(5)));
      } else {
        assert_eq!(segment.bind_to, None);
      }
    }
  }

  #[test]
  fn adjacent_conflicts_coalesce_per_root() {
    // The conflicting group is fully duplicated; runs adjacent in a root's
    // sequence coalesce into one bundle per root.
    let plan = run(
      vec![vec![1, 2, 3], vec![3, 1, 2]],
      vec![(1, 0), (2, 0), (3, 0)],
    );
    assert_eq!(plan.conflicts, vec![a(1), a(2), a(3)]);
    assert_eq!(plan.segments.len(), 2);
    for root in 0..2 {
      let emitted: Vec<u32> = plan.root_order[root]
        .iter()
        .flat_map(|&slot| plan.segments[slot as usize].assets.iter().map(|a| a.0))
        .collect();
      let expected: Vec<u32> = [vec![1, 2, 3], vec![3, 1, 2]][root].clone();
      assert_eq!(emitted, expected);
    }
  }
}
