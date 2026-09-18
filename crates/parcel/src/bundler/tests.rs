use super::availability::{
  AvailabilityEdge, AvailabilityEdgeKind, AvailabilityGraph, AvailabilityState,
};
use super::*;
use AvailabilityEdgeKind::{Lazy, Parallel, Sync};

fn bits(len: usize, ones: impl IntoIterator<Item = usize>) -> FixedBitSet {
  let mut set = FixedBitSet::with_capacity(len);
  set.extend(ones);
  set
}

fn matrix<'a>(columns: usize, rows: impl IntoIterator<Item = &'a [usize]>) -> BitMatrix {
  let rows: Vec<_> = rows.into_iter().collect();
  let mut matrix = BitMatrix::new(rows.len(), columns);
  for (row, ones) in rows.into_iter().enumerate() {
    for &one in ones {
      matrix.insert(row, one);
    }
  }
  matrix
}

fn edge(root: u32, kind: AvailabilityEdgeKind) -> AvailabilityEdge {
  AvailabilityEdge::new(root, kind)
}

struct Graph {
  roots: usize,
  // The first `roots` assets are the roots themselves.
  memberships: Vec<Vec<usize>>,
  boundaries: Vec<usize>,
  groups: Vec<(usize, Vec<AvailabilityEdge>)>,
}

impl Graph {
  fn new(roots: usize) -> Self {
    Self {
      roots,
      memberships: (0..roots).map(|r| vec![r]).collect(),
      boundaries: vec![0],
      groups: Vec::new(),
    }
  }

  fn asset(&mut self, roots: &[usize]) -> usize {
    let asset = self.memberships.len();
    self.memberships.push(roots.to_vec());
    asset
  }

  fn compressed(&self) -> (Reachability, AvailabilityGraph) {
    let sets = matrix(
      self.roots,
      self.memberships.iter().map(Vec::as_slice).chain([&[][..]]),
    );
    let reachability =
      Reachability::from_components((0..self.memberships.len() as u32).collect(), sets);
    let graph = AvailabilityGraph::new(
      &reachability,
      bits(self.roots, self.boundaries.iter().copied()),
      self
        .groups
        .iter()
        .map(|(asset, edges)| {
          (
            reachability.class(AssetIndex::from_index(*asset)),
            edges.clone(),
          )
        })
        .collect(),
    );
    (reachability, graph)
  }

  // Intentionally uncompressed: expand the root/occurrence cross product and
  // rebuild every IN from all predecessors on each simultaneous full sweep.
  // This shares neither the bitset representation nor the worklist algorithm.
  fn reference(&self) -> Vec<Vec<bool>> {
    let assets = self.memberships.len();
    let synchronous: Vec<Vec<bool>> = (0..self.roots)
      .map(|r| {
        self
          .memberships
          .iter()
          .map(|roots| roots.contains(&r))
          .collect()
      })
      .collect();
    let mut boundary: Vec<_> = (0..self.roots)
      .map(|r| self.boundaries.contains(&r))
      .collect();
    let mut live = boundary.clone();
    loop {
      let previous = live.clone();
      for (asset, edges) in &self.groups {
        if self.memberships[*asset].iter().any(|r| live[*r]) {
          for edge in edges {
            live[edge.root()] = true;
          }
        }
      }
      if live == previous {
        break;
      }
    }
    for r in 0..self.roots {
      boundary[r] |= !live[r];
    }

    let mut incoming = vec![Vec::<(usize, Vec<bool>)>::new(); self.roots];
    for (asset, edges) in &self.groups {
      for &parent in &self.memberships[*asset] {
        let mut prefix = synchronous[parent].clone();
        for edge in edges {
          let target = edge.root();
          let generated = match edge.kind() {
            Sync => vec![false; assets],
            Lazy => synchronous[parent].clone(),
            Parallel => prefix.clone(),
          };
          incoming[target].push((parent, generated));
          if matches!(edge.kind(), Parallel) && !boundary[target] {
            for a in 0..assets {
              prefix[a] |= synchronous[target][a];
            }
          }
        }
      }
    }

    let mut available: Vec<_> = boundary.iter().map(|b| vec![!*b; assets]).collect();
    for _ in 0..=self.roots * assets + 1 {
      let mut next = vec![vec![true; assets]; self.roots];
      for r in 0..self.roots {
        if boundary[r] {
          next[r].fill(false);
        } else {
          for (parent, generated) in &incoming[r] {
            for a in 0..assets {
              next[r][a] &= available[*parent][a] || generated[a];
            }
          }
        }
      }
      if next == available {
        return available;
      }
      available = next;
    }
    panic!("reference solver did not converge");
  }

  fn check(&self) -> Vec<Vec<bool>> {
    let (reachability, graph) = self.compressed();
    let available = graph.solve();
    let expanded: Vec<Vec<bool>> = available
      .iter()
      .map(|set| {
        (0..self.memberships.len())
          .map(|a| set.contains(reachability.class(AssetIndex::from_index(a))))
          .collect()
      })
      .collect();
    assert_eq!(expanded, self.reference());
    expanded
  }
}

#[test]
fn availability_intersects_all_ancestries_at_asset_granularity() {
  let mut g = Graph::new(4);
  let one_parent = g.asset(&[1, 3]);
  let both_parents = g.asset(&[1, 2, 3]);
  g.groups = vec![
    (0, vec![edge(1, Lazy), edge(2, Lazy)]),
    (1, vec![edge(3, Lazy)]),
    (2, vec![edge(3, Lazy)]),
  ];
  let result = g.check();
  assert!(!result[3][one_parent]);
  assert!(result[3][both_parents]);
  assert!(!result[3][1] && !result[3][2]);
}

#[test]
fn availability_cycles_cannot_supply_facts_on_the_first_load() {
  let mut g = Graph::new(3);
  let ancestor = g.asset(&[0, 1, 2]);
  let cycle_only = g.asset(&[2]);
  g.groups = vec![
    (0, vec![edge(1, Lazy)]),
    (1, vec![edge(2, Lazy)]),
    (2, vec![edge(1, Lazy)]),
  ];
  let result = g.check();
  assert!(result[1][ancestor] && result[2][ancestor]);
  assert!(!result[1][cycle_only]);
  assert!(result[0].iter().all(|a| !a));
}

#[test]
fn availability_parallel_prefix_is_ordered_and_occurrence_specific() {
  let mut g = Graph::new(5);
  let shared = g.asset(&[2, 3, 4]);
  g.boundaries = vec![0, 1];
  g.groups = vec![(0, vec![edge(2, Parallel), edge(4, Lazy), edge(3, Parallel)])];
  let result = g.check();
  assert!(result[3][shared]);
  assert!(!result[2][shared]);
  assert!(!result[4][shared]);
  // A second page loads the same scripts in the opposite order.
  g.groups
    .push((1, vec![edge(3, Parallel), edge(2, Parallel)]));
  let result = g.check();
  assert!(!result[2][shared] && !result[3][shared]);
}

#[test]
fn availability_does_not_merge_prefixes_of_assets_in_the_same_class() {
  let mut g = Graph::new(3);
  let source = g.asset(&[0]);
  let shared = g.asset(&[1, 2]);
  g.groups = vec![
    (0, vec![edge(1, Parallel)]),
    (source, vec![edge(2, Parallel)]),
  ];
  assert!(!g.check()[2][shared]);
}

#[test]
fn availability_repeated_parallel_occurrences_include_the_first() {
  let mut g = Graph::new(2);
  g.groups = vec![(0, vec![edge(1, Parallel), edge(1, Parallel)])];
  assert!(!g.check()[1][1]);
}

#[test]
fn availability_boundaries_reset_input_but_generate_for_descendants() {
  let mut g = Graph::new(4);
  g.boundaries = vec![0, 1];
  g.groups = vec![
    (0, vec![edge(1, Parallel), edge(2, Parallel)]),
    (1, vec![edge(3, Lazy)]),
  ];
  let result = g.check();
  assert!(result[1].iter().all(|a| !a));
  assert!(!result[2][1]);
  assert!(result[3][1]);
  assert!(!result[3][0]);
}

#[test]
fn availability_sync_roots_cannot_depend_on_the_importers_own_assets() {
  let mut g = Graph::new(3);
  g.groups = vec![(0, vec![edge(1, Lazy)]), (1, vec![edge(2, Sync)])];
  let result = g.check();
  assert!(result[2][0]);
  assert!(!result[2][1]);
}

#[test]
fn availability_unreachable_cycles_have_empty_input() {
  let mut g = Graph::new(3);
  g.groups = vec![(1, vec![edge(2, Lazy)]), (2, vec![edge(1, Lazy)])];
  assert!(g.check().iter().flatten().all(|a| !a));
}

#[test]
fn availability_filters_requirements_and_preserves_bundle_roots() {
  let mut g = Graph::new(3);
  let shared = g.asset(&[0, 1, 2]);
  g.groups = vec![(0, vec![edge(1, Lazy)]), (1, vec![edge(2, Lazy)])];
  let (reachability, graph) = g.compressed();
  let roots = BundleRoots::from_asset_graph(&asset_graph(
    g.memberships.len(),
    &[0],
    &[(0, 1, Priority::Lazy), (0, 2, Priority::Lazy)],
  ));
  let needed = graph.needed_roots(reachability, &roots, &graph.solve());
  assert_eq!(
    needed.reachable_roots(AssetIndex::from_index(shared)),
    bits(3, [0]).bits()
  );
  for r in 0..g.roots {
    assert!(
      needed
        .reachable_roots(AssetIndex::from_index(r))
        .contains(r)
    );
  }
}

#[test]
fn availability_matches_uncompressed_reference_on_generated_graphs() {
  let mut seed = 0x5eed_u64;
  let mut random = |n: usize| {
    seed = seed
      .wrapping_mul(6364136223846793005)
      .wrapping_add(1442695040888963407);
    ((seed >> 32) as usize) % n
  };
  for case in 0..400 {
    let roots = 2 + random(8);
    let mut g = Graph::new(roots);
    for r in 1..roots {
      if random(5) == 0 {
        g.boundaries.push(r);
      }
    }
    // Include empty signatures, duplicate signatures, and sets wider than one
    // machine word (including a partially occupied final word).
    for _ in 0..if case % 20 == 0 { 193 } else { 17 } {
      let membership: Vec<_> = (0..roots).filter(|_| random(2) == 0).collect();
      g.asset(&membership);
    }
    for asset in 0..g.memberships.len() {
      let edges = (0..random(5))
        .map(|_| {
          edge(
            random(roots) as u32,
            match random(3) {
              0 => Sync,
              1 => Lazy,
              _ => Parallel,
            },
          )
        })
        .collect();
      g.groups.push((asset, edges));
    }
    g.check();
  }
}

#[test]
fn reachability_interns_equal_components_and_maps_stale_assets_to_empty() {
  let reachability = Reachability::from_components(
    vec![0, 1, 2, u32::MAX],
    matrix(3, [&[0, 2][..], &[0, 2], &[1], &[]]),
  );
  assert_eq!(
    reachability.class(AssetIndex(0)),
    reachability.class(AssetIndex(1))
  );
  assert_eq!(reachability.class_count(), 3);
  assert!(reachability.reachable_roots(AssetIndex(3)).is_clear());
}

#[test]
fn availability_large_graph_stores_root_by_class_not_asset_by_asset_sets() {
  let mut g = Graph::new(1_000);
  for a in 1_000..100_000 {
    g.asset(&[a % 1_000]);
  }
  for root in 0..999 {
    g.groups.push((root, vec![edge(root as u32 + 1, Lazy)]));
  }
  let (reachability, graph) = g.compressed();
  assert_eq!(reachability.class_count(), 1_001);
  assert_eq!(graph.edge_count(), 999);
  let available = graph.solve();
  assert_eq!(available.rows(), 1_000);
  assert_eq!(available.columns(), 1_001);
  assert_eq!(available[999].count_ones(), 999);
  assert!(!available[999].contains(reachability.class(AssetIndex(999))));
}

#[test]
fn availability_state_reuses_rows_with_stable_root_ids() {
  let mut g = Graph::new(3);
  g.groups = vec![(0, vec![edge(1, Lazy), edge(2, Lazy)])];
  let (reachability, graph) = g.compressed();
  let mut state = AvailabilityState::new(&graph);
  let row_allocations: Vec<_> = state
    .rows()
    .iter()
    .map(|row| row.blocks().as_ptr())
    .collect();

  let roots_graph = asset_graph(3, &[0], &[(0, 1, Priority::Lazy), (0, 2, Priority::Lazy)]);
  let mut roots = BundleRoots::from_asset_graph(&roots_graph);
  state.solve(&graph, &roots);
  roots.deactivate(1);
  let available = state.solve(&graph, &roots);

  assert!(available[1].is_clear());
  assert!(available[2].contains(reachability.class(AssetIndex(0))));
  assert_eq!(
    row_allocations,
    state
      .rows()
      .iter()
      .map(|row| row.blocks().as_ptr())
      .collect::<Vec<_>>()
  );
}

#[test]
fn deactivating_a_root_does_not_renumber_surviving_roots() {
  let graph = asset_graph(3, &[0], &[(0, 1, Priority::Lazy), (0, 2, Priority::Lazy)]);
  let mut roots = BundleRoots::from_asset_graph(&graph);
  assert_eq!(roots.root_index(AssetIndex(2)), Some(2));
  roots.deactivate(1);
  assert_eq!(
    roots.iter_active().collect::<Vec<_>>(),
    vec![(0, AssetIndex(0)), (2, AssetIndex(2))]
  );
  assert_eq!(roots.root_index(AssetIndex(2)), Some(2));
}

fn asset_graph(
  count: usize,
  entries: &[usize],
  edges: &[(usize, usize, Priority)],
) -> AssetGraph<'static> {
  use parcel_core::{
    AssetFlags, AssetNode, AssetNodeIndex, AssetSymbols, BufferContent, Dependency,
    DependencyResolution, Entry, ImportType, SourceLocation, SourceUrl,
  };
  use std::{borrow::Cow, sync::Arc};
  let mut assets: Vec<_> = (0..count)
    .map(|a| Asset {
      loc: SourceLocation {
        url: SourceUrl::parse(&format!("file:///project/{a}.js")).unwrap(),
        start: Default::default(),
        end: Default::default(),
      },
      ty: AssetType::Js,
      content: Arc::new(BufferContent::new_string(String::new())),
      target: Default::default(),
      pipeline: None,
      bundle_behavior: BundleBehavior::None,
      flags: AssetFlags::SIDE_EFFECTS,
      unique_key: None,
      dependencies: Vec::new(),
      symbols: AssetSymbols::default(),
    })
    .collect();
  for &(source, target, priority) in edges {
    let target_env = assets[target].target.clone();
    assets[source].dependencies.push(Dependency {
      specifier: format!("./{target}.js").into_boxed_str(),
      specifier_type: SpecifierType::Esm,
      priority,
      bundle_behavior: BundleBehavior::None,
      import_type: ImportType::JavaScript,
      flags: DependencyFlags::SIDE_EFFECTS,
      target: target_env,
      loc: None,
      placeholder: None,
      resolve_from: None,
      range: None,
      conditions: Default::default(),
      resolution: DependencyResolution::Asset(AssetNodeIndex::from_index(target)),
    });
  }
  AssetGraph {
    asset_nodes: Cow::Owned(
      assets
        .iter()
        .enumerate()
        .map(|(a, asset)| AssetNode::from_asset(AssetIndex::from_index(a), asset))
        .collect(),
    ),
    entries: Cow::Owned(
      entries
        .iter()
        .map(|&asset| Entry {
          url: assets[asset].loc.url.clone(),
          target: assets[asset].target.clone(),
          dist_entry: None,
          asset: Some(AssetNodeIndex::from_index(asset)),
          loc: None,
        })
        .collect(),
    ),
    assets: Cow::Owned(assets),
  }
}

fn analyze(graph: &AssetGraph) -> (BundleRoots, Reachability, BitMatrix) {
  let roots = BundleRoots::from_asset_graph(graph);
  let reachability = Reachability::from_bundle_roots(graph, &roots);
  let available = AvailabilityGraph::from_asset_graph(graph, &roots, &reachability).solve();
  (roots, reachability, available)
}

#[test]
fn availability_asset_graph_intersects_opposite_html_orders() {
  let mut graph = asset_graph(
    5,
    &[0, 1],
    &[
      (0, 2, Priority::Parallel),
      (0, 3, Priority::Parallel),
      (1, 3, Priority::Parallel),
      (1, 2, Priority::Parallel),
      (2, 4, Priority::Sync),
      (3, 4, Priority::Sync),
    ],
  );
  graph.assets.to_mut()[0].ty = AssetType::Html;
  graph.assets.to_mut()[1].ty = AssetType::Html;
  let (roots, reachability, available) = analyze(&graph);
  for (r, asset) in roots.iter_active() {
    if asset == AssetIndex(2) || asset == AssetIndex(3) {
      assert!(!available[r].contains(reachability.class(AssetIndex(4))));
    }
  }
  graph.entries.to_mut().truncate(1);
  let (roots, reachability, available) = analyze(&graph);
  let r = roots
    .iter_active()
    .find(|(_, a)| *a == AssetIndex(3))
    .unwrap()
    .0;
  assert!(available[r].contains(reachability.class(AssetIndex(4))));
}

#[test]
fn availability_asset_graph_honors_inline_isolated_and_runtime_boundaries() {
  for boundary in 0..5 {
    let mut graph = asset_graph(
      4,
      &[0],
      &[
        (0, 1, Priority::Parallel),
        (0, 2, Priority::Parallel),
        (1, 3, Priority::Sync),
        (2, 3, Priority::Sync),
      ],
    );
    graph.assets.to_mut()[0].ty = AssetType::Html;
    match boundary {
      0 => graph.assets.to_mut()[2].bundle_behavior = BundleBehavior::Inline,
      1 => graph.assets.to_mut()[2].bundle_behavior = BundleBehavior::Isolated,
      2 => graph.assets.to_mut()[1].bundle_behavior = BundleBehavior::Isolated,
      3 => {
        std::sync::Arc::make_mut(&mut graph.assets.to_mut()[2].target).environment =
          Environment::WebWorker
      }
      _ => graph.assets.to_mut()[0].dependencies[1].bundle_behavior = BundleBehavior::Isolated,
    }
    let (roots, reachability, available) = analyze(&graph);
    let r = roots
      .iter_active()
      .find(|(_, a)| *a == AssetIndex(2))
      .unwrap()
      .0;
    assert!(
      !available[r].contains(reachability.class(AssetIndex(3))),
      "boundary {boundary}"
    );
  }
}

#[test]
fn availability_asset_graph_propagates_from_non_root_dependencies() {
  let graph = asset_graph(
    4,
    &[0],
    &[
      (0, 1, Priority::Sync),
      (0, 3, Priority::Sync),
      (1, 2, Priority::Lazy),
      (2, 3, Priority::Sync),
    ],
  );
  let (roots, reachability, available) = analyze(&graph);
  let r = roots
    .iter_active()
    .find(|(_, a)| *a == AssetIndex(2))
    .unwrap()
    .0;
  assert!(available[r].contains(reachability.class(AssetIndex(3))));
}

fn bundle(graph: AssetGraph<'static>) -> BundleGraph<'static> {
  DefaultBundler {
    min_bundle_size: 0,
    max_parallel_requests: 0,
    ..Default::default()
  }
  .bundle(graph, &ParcelOptions::default())
  .unwrap()
}

pub(super) fn placement_bundles(contents: &[&[u32]]) -> Vec<Bundle> {
  contents
    .iter()
    .enumerate()
    .map(|(index, assets)| Bundle {
      id: index as u64,
      ty: AssetType::Js,
      target: Default::default(),
      bundle_behavior: BundleBehavior::None,
      flags: BundleFlags::empty(),
      dist_path: None,
      assets: assets.iter().copied().map(AssetIndex).collect(),
      entry_assets: Vec::new(),
      main_entry_asset: None,
      referenced_bundles: Vec::new(),
    })
    .collect()
}

#[test]
fn placements_include_all_copies_but_not_entry_facades() {
  let mut bundles = placement_bundles(&[&[0, 2, 0], &[], &[2, 0]]);
  bundles[1].main_entry_asset = Some(AssetIndex(0));
  bundles[1].entry_assets.push(AssetIndex(0));
  bundles[1].referenced_bundles.push(0);
  let placements = AssetPlacements::new(4, &bundles);
  assert_eq!(placements.bundles(AssetIndex(0)), &[0, 2]);
  assert_eq!(placements.bundles(AssetIndex(2)), &[0, 2]);
  assert!(placements.bundles(AssetIndex(1)).is_empty());
  assert!(placements.bundles(AssetIndex(3)).is_empty());

  // Rebuilding after moving content must not retain stale owners.
  bundles[0].assets.clear();
  let placements = AssetPlacements::new(4, &bundles);
  assert_eq!(placements.bundles(AssetIndex(0)), &[2]);
  assert_eq!(placements.bundles(AssetIndex(2)), &[2]);
}

#[test]
fn duplicated_importers_each_reference_the_target_content() {
  let graph = asset_graph(
    3,
    &[0, 2],
    &[(0, 1, Priority::Sync), (2, 1, Priority::Sync)],
  );
  // Bundle 0 is an unrelated copy of the target. Bundle 4 is an entry facade.
  // Neither should be selected instead of the explicitly assigned content owner.
  let mut bundles = placement_bundles(&[&[1], &[0, 2], &[0], &[1], &[]]);
  bundles[4].main_entry_asset = Some(AssetIndex(1));
  bundles[4].entry_assets.push(AssetIndex(1));
  bundles[4].referenced_bundles.push(3);
  let roots = HashMap::from([(
    AssetIndex(1),
    RootBundle {
      load: 4,
      content: 3,
    },
  )]);
  let mut resolutions = HashMap::new();
  resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
  assert_eq!(bundles[1].referenced_bundles, [3]);
  assert_eq!(bundles[2].referenced_bundles, [3]);
  assert!(bundles[0].referenced_bundles.is_empty());
  assert!(bundles[3].referenced_bundles.is_empty());
  assert!(resolutions.is_empty());
}

#[test]
fn partially_colocated_dependencies_only_reference_from_nonlocal_copies() {
  let graph = asset_graph(2, &[0], &[(0, 1, Priority::Sync)]);
  // The first source and target placements match; the second source still needs
  // a reference. Swapping the copies must produce the same result.
  for local in [0, 1] {
    let mut bundles = placement_bundles(&[&[0], &[0], &[1]]);
    bundles[local].assets.push(AssetIndex(1));
    let roots = HashMap::from([(
      AssetIndex(1),
      RootBundle {
        load: 2,
        content: 2,
      },
    )]);
    let mut resolutions = HashMap::new();
    resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
    assert!(bundles[local].referenced_bundles.is_empty());
    assert_eq!(bundles[1 - local].referenced_bundles, [2]);
    assert!(resolutions.is_empty());
  }
}

#[test]
fn duplicated_targets_reuse_each_importers_existing_provider() {
  let graph = asset_graph(2, &[0], &[(0, 1, Priority::Sync)]);
  let mut bundles = placement_bundles(&[&[0], &[0], &[], &[1], &[1], &[1]]);
  bundles[0].referenced_bundles.push(3);
  bundles[1].referenced_bundles.push(2);
  // Traverse a cycle to find a transitive provider without adding the fallback.
  bundles[2].referenced_bundles.extend([1, 4]);
  let roots = HashMap::from([(
    AssetIndex(1),
    RootBundle {
      load: 5,
      content: 5,
    },
  )]);
  let mut resolutions = HashMap::new();
  resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
  assert_eq!(bundles[0].referenced_bundles, [3]);
  assert_eq!(bundles[1].referenced_bundles, [2]);
  assert_eq!(bundles[2].referenced_bundles, [1, 4]);
  assert!(resolutions.is_empty());
}

#[test]
fn reference_cycles_without_a_provider_still_add_one() {
  let graph = asset_graph(2, &[0], &[(0, 1, Priority::Sync)]);
  let mut bundles = placement_bundles(&[&[0], &[], &[1]]);
  bundles[0].referenced_bundles.push(1);
  bundles[1].referenced_bundles.push(0);
  let roots = HashMap::from([(
    AssetIndex(1),
    RootBundle {
      load: 2,
      content: 2,
    },
  )]);
  let mut resolutions = HashMap::new();
  resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
  assert_eq!(bundles[0].referenced_bundles, [1, 2]);
  assert!(resolutions.is_empty());
}

#[test]
fn duplicated_importers_preserve_explicit_loading_boundaries() {
  for boundary in 0..6 {
    let mut graph = asset_graph(2, &[0], &[(0, 1, Priority::Sync)]);
    let mut bundles = placement_bundles(&[&[0, 1], &[0], &[1], &[]]);
    bundles[3].main_entry_asset = Some(AssetIndex(1));
    bundles[3].entry_assets.push(AssetIndex(1));
    bundles[3].referenced_bundles.push(2);
    let dep = &mut graph.assets.to_mut()[0].dependencies[0];
    dep.flags |= DependencyFlags::NEEDS_STABLE_NAME;
    match boundary {
      0 => dep.priority = Priority::Lazy,
      1 => dep.priority = Priority::Parallel,
      2 => dep.specifier_type = SpecifierType::Url,
      3 => dep.bundle_behavior = BundleBehavior::Inline,
      4 => dep.bundle_behavior = BundleBehavior::Isolated,
      _ => bundles[3].bundle_behavior = BundleBehavior::Inline,
    }
    let roots = HashMap::from([(
      AssetIndex(1),
      RootBundle {
        load: 3,
        content: 2,
      },
    )]);
    let mut resolutions = HashMap::new();
    resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
    assert_eq!(
      resolutions[&DependencyId {
        asset: AssetIndex(0),
        dependency: 0
      }],
      BundleGraphDependencyResolution::Bundle {
        bundle_index: 3,
        asset_index: AssetIndex(1)
      },
      "boundary {boundary}"
    );
    assert!(bundles[0].referenced_bundles.is_empty());
    assert!(bundles[1].referenced_bundles.is_empty());
    assert!(bundles[3].flags.contains(BundleFlags::NEEDS_STABLE_NAME));
    assert!(!bundles[2].flags.contains(BundleFlags::NEEDS_STABLE_NAME));
  }
}

#[test]
fn mirrored_dependencies_remain_local_without_matching_first_owners() {
  let graph = asset_graph(2, &[0], &[(0, 1, Priority::Sync)]);
  let mut bundles = placement_bundles(&[&[1], &[0, 1], &[0, 1]]);
  for bundle in &mut bundles {
    bundle.ty = AssetType::Css;
  }
  let roots = HashMap::from([(
    AssetIndex(1),
    RootBundle {
      load: 0,
      content: 0,
    },
  )]);
  let mut resolutions = HashMap::new();
  resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
  assert!(bundles.iter().all(|b| b.referenced_bundles.is_empty()));
  assert!(resolutions.is_empty());
}

#[test]
fn duplicated_importers_keep_internalized_dependencies() {
  let graph = asset_graph(2, &[0], &[(0, 1, Priority::Lazy)]);
  let mut bundles = placement_bundles(&[&[0], &[0], &[1]]);
  let roots = HashMap::from([(
    AssetIndex(1),
    RootBundle {
      load: 2,
      content: 2,
    },
  )]);
  let dependency = DependencyId {
    asset: AssetIndex(0),
    dependency: 0,
  };
  let mut resolutions = HashMap::from([(
    dependency,
    BundleGraphDependencyResolution::Internalized(AssetIndex(1)),
  )]);
  resolve_bundle_dependencies(&graph, &mut bundles, &roots, &mut resolutions);
  assert_eq!(
    resolutions[&dependency],
    BundleGraphDependencyResolution::Internalized(AssetIndex(1))
  );
  assert!(bundles.iter().all(|b| b.referenced_bundles.is_empty()));
}

#[test]
fn reachability_crosses_sync_roots_and_seeds_every_root_in_a_cycle() {
  let graph = asset_graph(
    4,
    &[0],
    &[
      (0, 1, Priority::Lazy),
      (0, 2, Priority::Lazy),
      (1, 2, Priority::Sync),
      (2, 1, Priority::Sync),
      (2, 3, Priority::Sync),
    ],
  );
  let (_, reachability, _) = analyze(&graph);
  for asset in [1, 2, 3] {
    assert_eq!(
      reachability.reachable_roots(AssetIndex(asset)),
      bits(3, [1, 2]).bits()
    );
  }
}

#[test]
fn internalization_demotes_a_root_without_traversing_the_lazy_edge() {
  let graph = bundle(asset_graph(
    3,
    &[0],
    &[
      (0, 1, Priority::Sync),
      (0, 2, Priority::Lazy),
      (1, 1, Priority::Lazy),
      (2, 1, Priority::Lazy),
    ],
  ));
  assert_eq!(
    graph.dependency_resolution(AssetIndex(2), 0),
    BundleGraphDependencyResolution::Internalized(AssetIndex(1))
  );
  assert_eq!(
    graph.dependency_resolution(AssetIndex(1), 0),
    BundleGraphDependencyResolution::Internalized(AssetIndex(1))
  );
  assert_eq!(graph.bundles.len(), 2);
  assert_eq!(
    graph
      .bundles
      .iter()
      .find(|b| b.assets.contains(&AssetIndex(2)))
      .unwrap()
      .assets,
    [AssetIndex(2)]
  );
  assert_eq!(
    graph
      .bundles
      .iter()
      .filter(|b| b.assets.contains(&AssetIndex(1)))
      .count(),
    1
  );
}

#[test]
fn internalization_requires_every_context_of_a_shared_importer() {
  for guaranteed in [false, true] {
    let mut edges = vec![
      (0, 2, Priority::Sync),
      (1, 2, Priority::Sync),
      (0, 3, Priority::Sync),
      (2, 3, Priority::Lazy),
    ];
    if guaranteed {
      edges.push((1, 3, Priority::Sync));
    }
    let graph = bundle(asset_graph(4, &[0, 1], &edges));
    assert_eq!(
      matches!(
        graph.dependency_resolution(AssetIndex(2), 0),
        BundleGraphDependencyResolution::Internalized(AssetIndex(3))
      ),
      guaranteed
    );
  }
}

#[test]
fn internalization_keeps_roots_with_a_remaining_loader() {
  let graph = bundle(asset_graph(
    3,
    &[0, 1],
    &[
      (0, 2, Priority::Sync),
      (0, 2, Priority::Lazy),
      (1, 2, Priority::Lazy),
    ],
  ));
  assert_eq!(
    graph.dependency_resolution(AssetIndex(0), 1),
    BundleGraphDependencyResolution::Internalized(AssetIndex(2))
  );
  let BundleGraphDependencyResolution::Bundle {
    bundle_index,
    asset_index,
  } = graph.dependency_resolution(AssetIndex(1), 0)
  else {
    panic!("second entry still needs a loader")
  };
  assert_eq!(asset_index, AssetIndex(2));
  assert!(
    graph.bundles[bundle_index as usize]
      .assets
      .contains(&asset_index)
  );
}

#[test]
fn internalization_does_not_bootstrap_an_async_cycle() {
  let graph = bundle(asset_graph(
    3,
    &[0],
    &[
      (0, 1, Priority::Lazy),
      (1, 2, Priority::Lazy),
      (2, 1, Priority::Lazy),
    ],
  ));
  assert!(matches!(
    graph.dependency_resolution(AssetIndex(0), 0),
    BundleGraphDependencyResolution::Bundle { .. }
  ));
  assert!(matches!(
    graph.dependency_resolution(AssetIndex(1), 0),
    BundleGraphDependencyResolution::Bundle { .. }
  ));
  assert_eq!(
    graph.dependency_resolution(AssetIndex(2), 0),
    BundleGraphDependencyResolution::Internalized(AssetIndex(1))
  );
}

#[test]
fn internalization_retains_resource_and_runtime_boundaries() {
  for boundary in 0..6 {
    let mut graph = asset_graph(
      4,
      &[0],
      &[
        (0, 1, Priority::Sync),
        (0, 2, Priority::Lazy),
        (2, 1, Priority::Lazy),
        (1, 3, Priority::Sync),
      ],
    );
    match boundary {
      0 => graph.assets.to_mut()[1].bundle_behavior = BundleBehavior::Inline,
      1 => graph.assets.to_mut()[1].bundle_behavior = BundleBehavior::Isolated,
      2 => graph.assets.to_mut()[3].ty = AssetType::Css,
      3 => graph.assets.to_mut()[1].dependencies[0].priority = Priority::Parallel,
      4 => {
        std::sync::Arc::make_mut(&mut graph.assets.to_mut()[2].target).environment =
          Environment::WebWorker
      }
      _ => graph.assets.to_mut()[2].dependencies[0].specifier_type = SpecifierType::Url,
    }
    let graph = bundle(graph);
    assert!(
      matches!(
        graph.dependency_resolution(AssetIndex(2), 0),
        BundleGraphDependencyResolution::Bundle { .. }
      ),
      "boundary {boundary}"
    );
  }
}

#[test]
fn equal_root_keys_share_a_registration_only_payload_and_preserve_targets() {
  let graph = bundle(asset_graph(
    3,
    &[0],
    &[
      (0, 1, Priority::Lazy),
      (0, 2, Priority::Lazy),
      (1, 2, Priority::Sync),
      (2, 1, Priority::Sync),
    ],
  ));
  assert_eq!(graph.bundles.len(), 2);
  for dependency in 0..2 {
    let BundleGraphDependencyResolution::Bundle {
      bundle_index,
      asset_index,
    } = graph.dependency_resolution(AssetIndex(0), dependency)
    else {
      panic!("expected loader")
    };
    assert_eq!(asset_index, AssetIndex(dependency as u32 + 1));
    let payload = &graph.bundles[bundle_index as usize];
    assert_eq!(payload.assets.len(), 2);
    assert_eq!(payload.main_entry_asset, None);
    assert!(payload.entry_assets.is_empty());
    assert!(payload.referenced_bundles.is_empty());
  }
}

#[test]
fn entry_roots_in_a_sync_cycle_keep_independent_facades() {
  let graph = bundle(asset_graph(
    2,
    &[0, 1],
    &[(0, 1, Priority::Sync), (1, 0, Priority::Sync)],
  ));
  assert_eq!(graph.bundles.len(), 3);
  let payload = graph
    .bundles
    .iter()
    .position(|b| b.assets.len() == 2)
    .unwrap();
  assert_eq!(graph.bundles[payload].main_entry_asset, None);
  for entry in graph
    .bundles
    .iter()
    .filter(|b| b.flags.contains(BundleFlags::ENTRY))
  {
    assert!(entry.assets.is_empty());
    assert_eq!(entry.referenced_bundles, [payload]);
    assert_eq!(entry.entry_assets, [entry.main_entry_asset.unwrap()]);
  }
  assert_eq!(
    graph
      .bundles
      .iter()
      .filter(|b| b.flags.contains(BundleFlags::ENTRY))
      .count(),
    2
  );
}

#[test]
fn manual_roots_keep_their_loading_policy() {
  let graph = asset_graph(2, &[0], &[(0, 1, Priority::Sync), (0, 1, Priority::Lazy)]);
  let graph = DefaultBundler {
    manual_shared_bundles: vec![ManualSharedBundle {
      assets: vec!["**/1.js".into()],
      types: vec![],
    }],
    ..Default::default()
  }
  .bundle(graph, &ParcelOptions::default())
  .unwrap();
  assert!(matches!(
    graph.dependency_resolution(AssetIndex(0), 1),
    BundleGraphDependencyResolution::Bundle { .. }
  ));
  assert_eq!(graph.bundles.len(), 2);
}

#[test]
fn manual_lazy_roots_deduplicate_without_extra_facades() {
  let graph = asset_graph(3, &[0], &[(0, 1, Priority::Lazy), (0, 2, Priority::Lazy)]);
  let graph = DefaultBundler {
    manual_shared_bundles: vec![ManualSharedBundle {
      assets: vec!["**/1.js".into(), "**/2.js".into()],
      types: vec![],
    }],
    ..Default::default()
  }
  .bundle(graph, &ParcelOptions::default())
  .unwrap();
  assert_eq!(graph.bundles.len(), 2);
  let payload = graph
    .bundles
    .iter()
    .find(|b| b.assets.contains(&AssetIndex(1)))
    .unwrap();
  assert_eq!(payload.assets.len(), 2);
  assert!(payload.main_entry_asset.is_none());
}

#[test]
fn internalization_uses_only_preceding_parallel_roots() {
  for reversed in [false, true] {
    let mut graph = asset_graph(
      4,
      &[0],
      &[
        (0, 1, Priority::Parallel),
        (0, 2, Priority::Parallel),
        (1, 3, Priority::Sync),
        (2, 3, Priority::Lazy),
      ],
    );
    graph.assets.to_mut()[0].ty = AssetType::Html;
    if reversed {
      graph.assets.to_mut()[0].dependencies.reverse();
    }
    let graph = bundle(graph);
    assert_eq!(
      matches!(
        graph.dependency_resolution(AssetIndex(2), 0),
        BundleGraphDependencyResolution::Internalized(AssetIndex(3))
      ),
      !reversed
    );
  }
}

#[test]
fn synchronous_reachability_matches_independent_walks_through_root_cycles() {
  let mut seed = 7u32;
  for _ in 0..100 {
    let mut edges = Vec::new();
    for _ in 0..120 {
      seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
      let source = (seed % 30) as usize;
      seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
      let target = (seed % 30) as usize;
      let priority = if seed % 7 == 0 {
        Priority::Lazy
      } else {
        Priority::Sync
      };
      edges.push((source, target, priority));
    }
    let graph = asset_graph(30, &[0, 1], &edges);
    let roots = BundleRoots::from_asset_graph(&graph);
    let reachability = Reachability::from_bundle_roots(&graph, &roots);
    for (root_index, root) in roots.iter_active() {
      let mut visited = [false; 30];
      let mut pending = vec![root.index()];
      while let Some(source) = pending.pop() {
        if visited[source] {
          continue;
        }
        visited[source] = true;
        for &(from, to, priority) in &edges {
          if from == source && priority == Priority::Sync {
            pending.push(to);
          }
        }
      }
      for (asset, visited) in visited.into_iter().enumerate() {
        assert_eq!(
          reachability
            .reachable_roots(AssetIndex::from_index(asset))
            .contains(root_index),
          visited
        );
      }
    }
  }
}

#[test]
fn synchronous_reachability_handles_deep_graphs_and_already_visited_roots() {
  let count = 20_000;
  let mut edges: Vec<_> = (0..count - 1).map(|a| (a, a + 1, Priority::Sync)).collect();
  edges.extend((500..count).step_by(500).map(|a| (0, a, Priority::Lazy)));
  let graph = asset_graph(count, &[0], &edges);
  let roots = BundleRoots::from_asset_graph(&graph);
  let reachability = Reachability::from_bundle_roots(&graph, &roots);
  assert_eq!(roots.len(), 40);
  assert_eq!(
    reachability
      .reachable_roots(AssetIndex::from_index(count - 1))
      .count_ones(),
    roots.len()
  );
  assert_eq!(reachability.class_count(), roots.len() + 1);
}

#[test]
fn consolidation_uses_estimates_without_reading_content() {
  use parcel_core::{Content, Diagnostic};
  struct EstimateOnly(usize);
  impl Content for EstimateOnly {
    fn estimate_size(&self) -> Result<usize, Diagnostic> {
      Ok(self.0)
    }
    fn read(&self) -> Result<Vec<u8>, Diagnostic> {
      panic!("bundling must not serialize content");
    }
    fn ty(&self) -> ContentType {
      parcel_core::content_type!("EstimateOnly")
    }
  }
  for (size, expected_bundles) in [(499, 2), (500, 3)] {
    let mut graph = asset_graph(
      3,
      &[0, 1],
      &[(0, 2, Priority::Sync), (1, 2, Priority::Sync)],
    );
    for (i, asset) in graph.assets.to_mut().iter_mut().enumerate() {
      asset.content = std::sync::Arc::new(EstimateOnly(if i == 2 { size } else { 1000 }));
    }
    let graph = DefaultBundler {
      min_bundle_size: 500,
      max_parallel_requests: 0,
      ..Default::default()
    }
    .bundle(graph, &ParcelOptions::default())
    .unwrap();
    assert_eq!(graph.bundles.len(), expected_bundles);
  }
}
