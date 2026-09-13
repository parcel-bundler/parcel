//! Per-context CSS application order, and a bundle plan that preserves it.
//!
//! Cascade order is semantic in CSS, so a bundle partition is only correct if
//! every bundle's internal order agrees with all of its consumers and each
//! bundle's assets are contiguous in every consumer's order. Stylesheets that
//! consumers order inconsistently are duplicated per consumer instead, which
//! is always order-correct because each context positions its own copy.

use std::collections::HashSet;

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
  let sequences = sequences(asset_graph, bundle_roots, needed_roots);

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

  segment(&sequences, &group_of)
}

/// Application order of the CSS assets each root loads, derived from the same
/// synchronous edges as reachability classes. Emission is postorder (imports
/// before their importer), deduplicated so the last occurrence wins, matching
/// browser semantics for repeated imports and the packager's inline order.
fn sequences(
  asset_graph: &AssetGraph,
  bundle_roots: &BundleRoots,
  needed_roots: &Reachability,
) -> Vec<Vec<AssetIndex>> {
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

  let mut sequences = vec![Vec::new(); bundle_roots.len()];
  let mut seen = FixedBitSet::with_capacity(asset_graph.assets.len());
  let mut entries = Vec::new();
  let mut out = Vec::new();
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
    for &entry in entries.iter().rev() {
      css_reverse_walk(
        asset_graph,
        bundle_roots,
        needed_roots,
        root_index,
        entry,
        &mut seen,
        &mut out,
      );
    }
    out.reverse();
    sequences[root_index] = out.clone();
  }
  sequences
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
  root_index: usize,
  asset_index: AssetIndex,
  seen: &mut FixedBitSet,
  out: &mut Vec<AssetIndex>,
) {
  if seen.put(asset_index.index()) {
    return;
  }
  let asset = asset_graph.asset(asset_index);
  if needed_roots
    .reachable_roots(asset_index)
    .contains(root_index)
  {
    out.push(asset_index);
  }
  let children: Vec<AssetIndex> = synchronous_dependencies(asset_graph, bundle_roots, asset)
    .filter(|target| asset_graph.asset(*target).ty == AssetType::Css)
    .collect();
  for target in children.into_iter().rev() {
    css_reverse_walk(
      asset_graph,
      bundle_roots,
      needed_roots,
      root_index,
      target,
      seen,
      out,
    );
  }
}

/// Partition grouped assets into ordered segments that every consumer can
/// emit contiguously, duplicating order-conflicted assets per consumer.
fn segment(sequences: &[Vec<AssetIndex>], group_of: &HashMap<AssetIndex, usize>) -> StylePlan {
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
  let mut conflicted: HashSet<AssetIndex> = HashSet::new();

  for (group, members) in members.iter().enumerate() {
    let consumers = &consumers[group];
    // Keep the maximal subset every consumer orders like the reference; the
    // rest are duplicated per consumer. A longest increasing subsequence of
    // each consumer's positions drops the fewest assets for that consumer.
    let mut survivors: Vec<AssetIndex> = members.clone();
    for &consumer in &consumers[1..] {
      let positions = &positions[consumer];
      let order: Vec<usize> = survivors
        .iter()
        .filter_map(|a| positions.get(a).copied())
        .collect();
      if order.len() == survivors.len() {
        let keep = longest_increasing(&order);
        if keep.len() != survivors.len() {
          let mut keep_iter = keep.iter().copied().peekable();
          survivors = survivors
            .iter()
            .enumerate()
            .filter_map(|(i, &a)| {
              if keep_iter.peek() == Some(&i) {
                keep_iter.next();
                Some(a)
              } else {
                conflicted.insert(a);
                None
              }
            })
            .collect();
        }
      }
    }

    // Split wherever any consumer interleaves something between neighbors.
    let mut ordinal = 0;
    let mut current: Vec<AssetIndex> = Vec::new();
    for (i, &asset) in survivors.iter().enumerate() {
      if i > 0 {
        let previous = survivors[i - 1];
        let split = consumers.iter().any(|&c| {
          match (positions[c].get(&previous), positions[c].get(&asset)) {
            (Some(&p), Some(&q)) => q > p + 1,
            _ => true,
          }
        });
        if split {
          push_segment(&mut plan, std::mem::take(&mut current), None, ordinal);
          ordinal += 1;
        }
      }
      current.push(asset);
    }
    if !current.is_empty() {
      push_segment(&mut plan, current, None, ordinal);
    }
  }

  // Duplicate conflicted assets per consuming root, coalescing runs that are
  // adjacent in that root's sequence into one bundle.
  for (root, sequence) in sequences.iter().enumerate() {
    let mut ordinal = 0;
    let mut run: Vec<AssetIndex> = Vec::new();
    let mut last_position = 0;
    for (position, &asset) in sequence.iter().enumerate() {
      if conflicted.contains(&asset) {
        if !run.is_empty() && position != last_position + 1 {
          push_segment(&mut plan, std::mem::take(&mut run), Some(root), ordinal);
          ordinal += 1;
        }
        run.push(asset);
        last_position = position;
      }
    }
    if !run.is_empty() {
      push_segment(&mut plan, run, Some(root), ordinal);
    }
  }

  // Application order of planned segments per root.
  for (root, sequence) in sequences.iter().enumerate() {
    let mut order = Vec::new();
    for &asset in sequence {
      let Some(slots) = plan.slots.get(&asset) else {
        continue;
      };
      for &slot in slots {
        let segment = &plan.segments[slot as usize];
        if segment.owner_root.is_none_or(|owner| owner == root) && !order.contains(&slot) {
          order.push(slot);
        }
      }
    }
    plan.root_order[root] = order;
  }

  plan.conflicts = {
    let mut conflicts: Vec<AssetIndex> = conflicted.into_iter().collect();
    conflicts.sort_unstable_by_key(|a| a.index());
    conflicts
  };
  plan
}

fn push_segment(
  plan: &mut StylePlan,
  assets: Vec<AssetIndex>,
  owner_root: Option<usize>,
  ordinal: usize,
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
  });
}

/// Indices of a longest strictly increasing subsequence, preferring earlier
/// elements on ties for determinism.
fn longest_increasing(values: &[usize]) -> Vec<usize> {
  let mut tails: Vec<usize> = Vec::new(); // indices into values
  let mut previous: Vec<Option<usize>> = vec![None; values.len()];
  for (i, &value) in values.iter().enumerate() {
    let position = tails.partition_point(|&t| values[t] < value);
    if position > 0 {
      previous[i] = Some(tails[position - 1]);
    }
    if position == tails.len() {
      tails.push(i);
    } else {
      tails[position] = i;
    }
  }
  let mut result = Vec::new();
  let mut current = tails.last().copied();
  while let Some(i) = current {
    result.push(i);
    current = previous[i];
  }
  result.reverse();
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  fn a(i: u32) -> AssetIndex {
    AssetIndex(i)
  }

  fn run(sequences: Vec<Vec<u32>>, groups: Vec<(u32, usize)>) -> StylePlan {
    let sequences: Vec<Vec<AssetIndex>> = sequences
      .into_iter()
      .map(|s| s.into_iter().map(a).collect())
      .collect();
    let group_of = groups.into_iter().map(|(asset, g)| (a(asset), g)).collect();
    segment(&sequences, &group_of)
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
    // Root 0 loads x then y; root 1 loads y then x.
    let plan = run(vec![vec![1, 2], vec![2, 1]], vec![(1, 0), (2, 0)]);
    // One asset survives shared; the other is copied into each root.
    assert_eq!(plan.conflicts.len(), 1);
    let shared: Vec<_> = plan
      .segments
      .iter()
      .filter(|s| s.owner_root.is_none())
      .collect();
    assert_eq!(shared.len(), 1);
    let duplicates: Vec<_> = plan
      .segments
      .iter()
      .filter(|s| s.owner_root.is_some())
      .collect();
    assert_eq!(duplicates.len(), 2);
    // Each root's order follows its own sequence.
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
  fn adjacent_conflicts_coalesce_per_root() {
    // Both assets conflict between the roots and stay adjacent in each.
    let plan = run(
      vec![vec![1, 2, 3], vec![3, 1, 2]],
      vec![(1, 0), (2, 0), (3, 0)],
    );
    assert_eq!(plan.conflicts, vec![a(3)]);
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
