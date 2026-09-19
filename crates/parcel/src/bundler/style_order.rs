//! Per-context CSS application order, and a bundle plan that preserves it.
//!
//! Cascade order is semantic in CSS, so a bundle partition is only correct if
//! every bundle's internal order agrees with all of its consumers and each
//! bundle's assets are contiguous in every consumer's order. Stylesheets that
//! consumers order inconsistently are duplicated per consumer instead, which
//! is always order-correct because each context positions its own copy.

use std::collections::HashSet;

use parcel_core::{CodeFrame, CodeHighlight, Diagnostic, DiagnosticSeverity, LogLevel};
use parcel_css::bundling::{OrderAnalysis, OrderedContent};

use super::*;
use crate::bundler::reachability::is_sync_dep;

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
  /// Groups duplicated because consumers disagreed about their order.
  conflicts: Vec<Conflict>,
}

struct Conflict {
  assets: Vec<AssetIndex>,
  roots: Vec<usize>,
}

/// Compute per-root CSS application order and the resulting bundle plan.
/// `plannable` excludes assets whose grouping is fixed elsewhere (manual
/// bundles); they still take part in ordering as opaque neighbors.
pub(super) fn plan(
  asset_graph: &AssetGraph,
  bundle_roots: &BundleRoots,
  needed_roots: &Reachability,
  options: &ParcelOptions,
  plannable: impl Fn(&Asset) -> bool,
) -> StylePlan {
  let mut analysis = OrderAnalysis::new(asset_graph, |asset| {
    let asset = asset_graph.asset(asset);
    asset_graph
      .resolved_dependencies_with_indices(asset)
      .filter(|&(index, target)| {
        is_sync_dep(
          asset_graph,
          bundle_roots,
          asset,
          &asset.dependencies[index],
          target,
        )
      })
  });

  let mut contexts = vec![OrderedContent::default(); bundle_roots.len()];
  for (root_index, root_asset) in bundle_roots.iter_active() {
    contexts[root_index] = analysis.for_context(root_asset, |asset| {
      needed_roots.reachable_roots(asset).contains(root_index)
    });
  }

  // Group plannable assets by (consumer root set, packager) like BundleKey
  // does: distinct classes whose root sets collapsed together during
  // availability still share one bundle. First appearance order across roots
  // keeps group numbering deterministic.
  let mut group_ids: HashMap<(&BitRow, ContentType), usize> = HashMap::new();
  let mut group_of: HashMap<AssetIndex, usize> = HashMap::new();
  let mut group_count = 0;
  for context in &contexts {
    for &asset_index in &context.assets {
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
      Some(owner) => reach.count_ones() == 1 && reach.contains(owner),
    }
  };

  let plan = segment(&contexts, &group_of, &bindable);
  report_conflicts(
    &plan,
    &mut analysis,
    asset_graph,
    bundle_roots,
    &contexts,
    options,
  );

  plan
}

/// Partition grouped assets into ordered segments that every consumer can
/// emit contiguously, duplicating order-conflicted assets per consumer.
/// Content-specific keep-together intervals take private copies of their
/// groups for that context. `bindable` decides whether a segment adjacent to
/// a root asset may join that root's bundle.
fn segment(
  contexts: &[OrderedContent],
  group_of: &HashMap<AssetIndex, usize>,
  bindable: &dyn Fn(AssetIndex, AssetIndex, Option<usize>) -> bool,
) -> StylePlan {
  // Positions per root for interleave checks and order comparison.
  let sequences: Vec<&[AssetIndex]> = contexts.iter().map(|c| c.assets.as_slice()).collect();
  let positions: Vec<HashMap<AssetIndex, usize>> = sequences
    .iter()
    .map(|s| s.iter().enumerate().map(|(i, &a)| (a, i)).collect())
    .collect();

  // Group members in reference order (first consuming root's order), and the
  // consuming roots per group.
  let mut members: Vec<Vec<AssetIndex>> = Vec::new();
  let mut consumers: Vec<Vec<usize>> = Vec::new();
  let mut seen_assets = HashSet::new();
  for (root, sequence) in sequences.iter().enumerate() {
    for &asset in *sequence {
      let Some(&group) = group_of.get(&asset) else {
        continue;
      };
      while members.len() <= group {
        members.push(Vec::new());
        consumers.push(Vec::new());
      }
      if seen_assets.insert(asset) {
        members[group].push(asset);
      }
      if consumers[group].last() != Some(&root) {
        consumers[group].push(root);
      }
    }
  }
  drop(seen_assets);

  let mut plan = StylePlan {
    slots: HashMap::new(),
    segments: Vec::new(),
    root_order: vec![Vec::new(); sequences.len()],
    conflicts: Vec::new(),
  };
  // Roots that take a private copy of a whole group. A keep-together interval
  // privatizes its groups for that root only; an order
  // conflict privatizes it for every consumer, because successive lazy
  // activations share one document and a partially shared group already
  // loaded at an incompatible position could not be reordered. With full
  // copies, each activation re-asserts its own order and the last one wins,
  // deterministically, as per-link markup would behave natively.
  let mut owners = BitMatrix::new(members.len(), contexts.len());
  for (root, context) in contexts.iter().enumerate() {
    for range in &context.keep_together {
      for asset in &context.assets[range.clone()] {
        if let Some(&group) = group_of.get(asset) {
          owners.insert(group, root);
        }
      }
    }
  }
  let mut slot_consumers: Vec<Vec<usize>> = Vec::new();

  for (group, members) in members.iter().enumerate() {
    let owners = &mut owners[group];
    let mut shared: Vec<usize> = consumers[group]
      .iter()
      .copied()
      .filter(|&c| !owners.contains(c))
      .collect();
    // Reference order and conflict detection among the remaining sharers.
    let mut ordered = members.clone();
    if let Some(&reference) = shared.first() {
      ordered.sort_by_key(|a| positions[reference].get(a).copied());
      let conflicting = shared[1..].iter().any(|&consumer| {
        let positions = &positions[consumer];
        let order = ordered.iter().filter_map(|a| positions.get(a).copied());
        order.clone().count() == ordered.len() && !order.is_sorted()
      });
      if conflicting {
        plan.conflicts.push(Conflict {
          assets: ordered.clone(),
          roots: shared.clone(),
        });
        for consumer in shared.drain(..) {
          owners.insert(consumer);
        }
      }
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
  let is_owned = |root, asset| {
    group_of
      .get(&asset)
      .is_some_and(|&group| owners.contains(group, root))
  };
  for (root, sequence) in sequences.iter().enumerate() {
    let mut ordinal = 0;
    let mut run: Vec<AssetIndex> = Vec::new();
    let mut last_position = 0;
    for (position, &asset) in sequence.iter().enumerate() {
      if is_owned(root, asset) {
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
  let mut seen_segments = FixedBitSet::with_capacity(plan.segments.len());
  for (root, sequence) in sequences.iter().enumerate() {
    let mut order = Vec::new();
    for &asset in *sequence {
      let Some(slots) = plan.slots.get(&asset) else {
        continue;
      };
      let owned = is_owned(root, asset);
      for &slot in slots {
        let matches = match plan.segments[slot as usize].owner_root {
          Some(owner) => owned && owner == root,
          None => !owned,
        };
        if matches && !seen_segments.put(slot as usize) {
          order.push(slot);
        }
      }
    }
    for &slot in &order {
      seen_segments.set(slot as usize, false);
    }
    plan.root_order[root] = order;
  }

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
    keep_together: Vec<(usize, std::ops::Range<usize>)>,
    bindable: &dyn Fn(AssetIndex, AssetIndex, Option<usize>) -> bool,
  ) -> StylePlan {
    let mut contexts: Vec<OrderedContent> = sequences
      .into_iter()
      .map(|s| OrderedContent {
        assets: s.into_iter().map(a).collect(),
        keep_together: Vec::new(),
      })
      .collect();
    let group_of = groups.into_iter().map(|(asset, g)| (a(asset), g)).collect();
    for (root, range) in keep_together {
      contexts[root].keep_together.push(range);
    }
    segment(&contexts, &group_of, bindable)
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
    assert_eq!(plan.conflicts.len(), 1);
    assert_eq!(plan.conflicts[0].assets, vec![a(1), a(2)]);
    assert_eq!(plan.conflicts[0].roots, vec![0, 1]);
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
  fn keep_together_privatizes_groups_per_root() {
    // Root 0's sequence begins with a keep-together interval covering the
    // shared sheet 9 and its own sheet 1, so root 0 takes a private coalesced
    // copy; root 1 keeps sharing 9 with nobody else affected.
    let plan = run_full(
      vec![vec![9, 1], vec![9]],
      vec![(9, 0), (1, 1)],
      vec![(0, 0..2)],
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
  fn overlapping_intervals_coalesce_without_affecting_other_contexts() {
    let plan = run_full(
      vec![vec![1, 2, 3, 4], vec![1, 2, 3, 4]],
      vec![(1, 0), (2, 1), (3, 2), (4, 3)],
      vec![(0, 0..2), (0, 1..3)],
      &|_, _, _| false,
    );
    let owned: Vec<_> = plan
      .segments
      .iter()
      .filter(|s| s.owner_root.is_some())
      .collect();
    assert_eq!(owned.len(), 1);
    assert_eq!(owned[0].owner_root, Some(0));
    assert_eq!(owned[0].assets, vec![a(1), a(2), a(3)]);
    for order in &plan.root_order {
      let assets: Vec<_> = order
        .iter()
        .flat_map(|&slot| plan.segments[slot as usize].assets.iter().copied())
        .collect();
      assert_eq!(assets, vec![a(1), a(2), a(3), a(4)]);
    }
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
    assert_eq!(plan.conflicts[0].assets, vec![a(1), a(2), a(3)]);
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

fn report_conflicts(
  plan: &StylePlan,
  analysis: &mut OrderAnalysis,
  graph: &AssetGraph,
  roots: &BundleRoots,
  contexts: &[OrderedContent],
  options: &ParcelOptions,
) {
  if plan.conflicts.is_empty() || !options.log_level.allows(LogLevel::Warn) {
    return;
  }

  let mut paths = HashMap::new();
  let root_assets: HashMap<_, _> = roots.iter_active().collect();
  for conflict in &plan.conflicts {
    let assets: HashSet<_> = conflict.assets.iter().copied().collect();
    // Group by actual asset order, before collapsing filenames for display:
    // two styles in the same file can themselves be imported in reverse order.
    let mut orders: Vec<(Vec<AssetIndex>, Vec<usize>)> = Vec::new();
    let mut consumers = conflict.roots.clone();
    consumers.sort_by_key(|root| graph.asset(root_assets[root]).loc.url.to_string());
    for root in consumers {
      let order: Vec<_> = contexts[root]
        .assets
        .iter()
        .copied()
        .filter(|a| assets.contains(a))
        .collect();
      if let Some((_, consumers)) = orders.iter_mut().find(|(o, _)| *o == order) {
        consumers.push(root);
      } else {
        orders.push((order, vec![root]));
      }
    }

    let witnesses: Vec<_> = orders
      .iter()
      .enumerate()
      .skip(1)
      .filter_map(|(i, (order, _))| reversed_pair(&orders[0].0, order, graph).map(|pair| (i, pair)))
      .collect();
    let mut precise_urls = HashSet::new();
    for (_, [a, b]) in &witnesses {
      if graph.asset(*a).loc.url == graph.asset(*b).loc.url {
        precise_urls.insert(&graph.asset(*a).loc.url);
      }
    }

    // A → B → A can also conceal a swap between two locations in A. If
    // distinct orders would have identical summaries, disambiguate the
    // locations that differ rather than presenting the same order twice.
    let mut displayed_orders: HashMap<Vec<_>, &Vec<AssetIndex>> = HashMap::new();
    for (order, _) in &orders {
      let mut urls: Vec<_> = order.iter().map(|&a| &graph.asset(a).loc.url).collect();
      urls.dedup();

      if let Some(previous) = displayed_orders.get(&urls) {
        for (&a, &b) in previous.iter().zip(order) {
          if a != b {
            precise_urls.insert(&graph.asset(a).loc.url);
            precise_urls.insert(&graph.asset(b).loc.url);
          }
        }
      } else {
        displayed_orders.insert(urls, order);
      }
    }

    // Use short filenames unless they would be ambiguous within this warning.
    let urls: HashSet<_> = conflict
      .assets
      .iter()
      .map(|&a| &graph.asset(a).loc.url)
      .collect();
    let mut filenames = HashMap::new();
    for url in &urls {
      if let Ok(path) = url.to_file_path() {
        *filenames.entry(path.file_name().to_owned()).or_insert(0) += 1;
      }
    }

    let name = |asset| {
      let loc = &graph.asset(asset).loc;
      let mut name = loc.url.to_file_path().map_or_else(
        |_| loc.url.to_string(),
        |path| {
          if filenames.get(path.file_name()) == Some(&1) {
            path.file_name().to_owned()
          } else {
            path
              .relative(&options.project_root)
              .to_string_lossy()
              .into_owned()
          }
        },
      );

      if precise_urls.contains(&loc.url) {
        name.push_str(&format!(":{}:{}", loc.start.line, loc.start.column));
      }

      name
    };

    let mut diagnostic = Diagnostic {
      message: "Stylesheets are imported in conflicting orders by different contexts. Parcel duplicated this stylesheet group to preserve each context's order. Use a consistent import order to allow these styles to be shared.".into(),
      origin: Some("@parcel/bundler-default".into()),
      severity: DiagnosticSeverity::Warning,
      code_frames: Vec::new(),
      documentation_url: None,
      hints: Vec::new(),
    };

    for (i, (order, consumers)) in orders.iter().enumerate() {
      let mut names: Vec<_> = order.iter().map(|&a| name(a)).collect();
      names.dedup();
      let consumers = consumers
        .iter()
        .map(|root| {
          let url = &graph.asset(root_assets[root]).loc.url;
          url.to_file_path().map_or_else(
            |_| url.to_string(),
            |path| {
              path
                .relative(&options.project_root)
                .to_string_lossy()
                .into_owned()
            },
          )
        })
        .collect::<Vec<_>>()
        .join("\n  ");

      diagnostic.hints.push(format!(
        "Order {}: {}\nUsed by:\n  {}",
        i + 1,
        names.join(" → "),
        consumers
      ));
    }

    // One reversed pair proves why each distinct order cannot share the
    // reference order. Trace only these witnesses, not every style() call.
    let mut shown = HashSet::new();
    for (other, [a, b]) in witnesses {
      for (order, before, after) in [(0, a, b), (other, b, a)] {
        if !shown.insert((order, before, after)) {
          continue;
        }

        let root = orders[order].1[0];
        let parents = paths.entry(root).or_insert_with(|| {
          let mut parents = HashMap::new();
          analysis.for_context_with_imports(
            root_assets[&root],
            |_| true,
            |parent, child| {
              parents.insert(child, parent);
            },
          );
          parents
        });

        let [before_path, after_path] = [before, after].map(|asset| {
          let mut path = vec![asset];
          while let Some(&parent) = parents.get(path.last().unwrap()) {
            path.push(parent);
          }
          path.reverse();
          path
        });

        let common = before_path
          .iter()
          .zip(&after_path)
          .take_while(|(a, b)| a == b)
          .count();

        for (path, message) in [
          (
            &before_path,
            format!(
              "Order {}: {} before {}",
              order + 1,
              name(before),
              name(after)
            ),
          ),
          (
            &after_path,
            format!(
              "Order {}: {} after {}",
              order + 1,
              name(after),
              name(before)
            ),
          ),
        ] {
          // The first imports after the paths diverge establish their relative
          // order. An ancestor stylesheet uses its incoming import instead.
          let start = common.saturating_sub(1).min(path.len().saturating_sub(2));
          let source = path[start..].windows(2).find_map(|edge| {
            let importer = graph.asset(edge[0]);
            let mut imports =
              graph
                .resolved_dependencies_with_indices(importer)
                .filter(|&(i, target)| {
                  target == edge[1]
                    && is_sync_dep(graph, roots, importer, &importer.dependencies[i], target)
                });

            let dependency = if importer.ty == AssetType::Css {
              imports.last()
            } else {
              imports.next()
            };

            dependency.and_then(|(i, _)| {
              importer.dependencies[i]
                .loc
                .as_ref()
                .map(|loc| (loc, importer))
            })
          });

          if let Some((loc, importer)) = source {
            add_conflict_frame(&mut diagnostic, loc, importer, message, options);
          }
        }
      }
    }

    for frame in &mut diagnostic.code_frames {
      frame
        .code_highlights
        .sort_by_key(|h| (h.start.line, h.start.column, h.end.line, h.end.column));
    }

    options
      .reporters
      .log_diagnostics(LogLevel::Warn, &[diagnostic]);
  }
}

/// An inversion of adjacent reference assets is enough to demonstrate a
/// conflict. Prefer different source files when both kinds of witness exist.
fn reversed_pair(
  reference: &[AssetIndex],
  order: &[AssetIndex],
  graph: &AssetGraph,
) -> Option<[AssetIndex; 2]> {
  let positions: HashMap<_, _> = order.iter().enumerate().map(|(i, &a)| (a, i)).collect();
  let mut reversed = reference
    .windows(2)
    .filter(|pair| matches!((positions.get(&pair[0]), positions.get(&pair[1])), (Some(a), Some(b)) if a > b));
  reversed
    .clone()
    .find(|pair| graph.asset(pair[0]).loc.url != graph.asset(pair[1]).loc.url)
    .or_else(|| reversed.next())
    .map(|pair| [pair[0], pair[1]])
}

fn add_conflict_frame(
  diagnostic: &mut Diagnostic,
  loc: &parcel_core::SourceLocation,
  importer: &Asset,
  mut message: String,
  options: &ParcelOptions,
) {
  let original = loc
    .url
    .to_file_path()
    .ok()
    .and_then(|path| options.input_fs.read_to_string(path).ok());
  let source = (loc.url == importer.loc.url)
    .then(|| parcel_js::diagnostic_source(importer))
    .flatten();
  if source
    .as_ref()
    .is_some_and(|code| original.as_ref() != Some(code))
  {
    message.push_str(" (transformed source)");
  }
  let code = source.or(original);
  let highlight = CodeHighlight::from_loc(loc, Some(message));
  if diagnostic.code_frames.iter().any(|f| {
    f.url.as_ref() == Some(&loc.url) && f.code == code && f.code_highlights.contains(&highlight)
  }) {
    return;
  }
  // Comparisons on the same source line need separate frames so each label
  // remains visible, without concatenating all their messages into one line.
  if let Some(frame) = diagnostic.code_frames.iter_mut().find(|f| {
    f.url.as_ref() == Some(&loc.url)
      && f.code == code
      && f
        .code_highlights
        .iter()
        .all(|h| h.end.line < highlight.start.line || h.start.line > highlight.end.line)
  }) {
    frame.code_highlights.push(highlight);
  } else {
    diagnostic.code_frames.push(CodeFrame {
      code,
      language: Some(importer.ty.clone()),
      ..CodeFrame::from_loc(loc, highlight.message)
    });
  }
}
