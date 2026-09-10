use super::*;
use AvailabilityEdgeKind::{Lazy, Parallel, Sync};

fn bits(len: usize, ones: impl IntoIterator<Item = usize>) -> FixedBitSet {
  let mut set = FixedBitSet::with_capacity(len);
  set.extend(ones);
  set
}

fn edge(root: u32, kind: AvailabilityEdgeKind) -> AvailabilityEdge {
  AvailabilityEdge { root, kind }
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
    let sets = self
      .memberships
      .iter()
      .map(|r| bits(self.roots, r.iter().copied()))
      .chain([bits(self.roots, [])])
      .collect();
    let reachability =
      Reachability::from_components((0..self.memberships.len() as u32).collect(), sets);
    let graph = AvailabilityGraph::new(
      &reachability.reachable_roots,
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
            live[edge.root as usize] = true;
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
          let target = edge.root as usize;
          let generated = match edge.kind {
            Sync => vec![false; assets],
            Lazy => synchronous[parent].clone(),
            Parallel => prefix.clone(),
          };
          incoming[target].push((parent, generated));
          if matches!(edge.kind, Parallel) && !boundary[target] {
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
  let roots = BundleRoots {
    root_assets: (0..g.roots).map(AssetIndex::from_index).collect(),
    root_indices: (0..g.memberships.len())
      .map(|asset| {
        if asset < g.roots {
          asset as u32
        } else {
          u32::MAX
        }
      })
      .collect(),
    active_roots: bits(g.roots, 0..g.roots),
    entry_bundle_roots: bits(g.memberships.len(), [0]),
    mandatory_roots: bits(g.memberships.len(), [0]),
    bundle_behaviors: vec![BundleBehavior::None; g.memberships.len()],
  };
  let needed = graph.needed_roots(reachability, &roots, &graph.solve());
  assert_eq!(
    needed.reachable_roots(AssetIndex::from_index(shared)),
    &bits(3, [0])
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
    vec![bits(3, [0, 2]), bits(3, [0, 2]), bits(3, [1]), bits(3, [])],
  );
  assert_eq!(
    reachability.class(AssetIndex(0)),
    reachability.class(AssetIndex(1))
  );
  assert_eq!(reachability.reachable_roots.len(), 3);
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
  assert_eq!(reachability.reachable_roots.len(), 1_001);
  assert_eq!(graph.edges.len(), 999);
  let available = graph.solve();
  assert_eq!(available.len(), 1_000);
  assert_eq!(available[999].len(), 1_001);
  assert_eq!(available[999].count_ones(..), 999);
  assert!(!available[999].contains(reachability.class(AssetIndex(999))));
}

#[test]
fn availability_state_reuses_rows_with_stable_root_ids() {
  let mut g = Graph::new(3);
  g.groups = vec![(0, vec![edge(1, Lazy), edge(2, Lazy)])];
  let (reachability, graph) = g.compressed();
  let mut state = AvailabilityState::new(&graph);
  let row_allocations: Vec<_> = state
    .available
    .iter()
    .map(|row| row.as_slice().as_ptr())
    .collect();

  let mut active = bits(3, 0..3);
  state.solve(&graph, &active);
  active.set(1, false);
  let available = state.solve(&graph, &active);

  assert!(available[1].is_clear());
  assert!(available[2].contains(reachability.class(AssetIndex(0))));
  assert_eq!(
    row_allocations,
    state
      .available
      .iter()
      .map(|row| row.as_slice().as_ptr())
      .collect::<Vec<_>>()
  );
}

#[test]
fn deactivating_a_root_does_not_renumber_surviving_roots() {
  let graph = asset_graph(3, &[0], &[(0, 1, Priority::Lazy), (0, 2, Priority::Lazy)]);
  let mut roots = BundleRoots::from_asset_graph(&graph);
  assert_eq!(roots.root_index(AssetIndex(2)), Some(2));
  roots.active_roots.set(1, false);
  assert_eq!(
    roots.iter().collect::<Vec<_>>(),
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

fn analyze(graph: &AssetGraph) -> (BundleRoots, Reachability, Vec<FixedBitSet>) {
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
  for (r, asset) in roots.iter() {
    if asset == AssetIndex(2) || asset == AssetIndex(3) {
      assert!(!available[r].contains(reachability.class(AssetIndex(4))));
    }
  }
  graph.entries.to_mut().truncate(1);
  let (roots, reachability, available) = analyze(&graph);
  let r = roots.iter().find(|(_, a)| *a == AssetIndex(3)).unwrap().0;
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
    let r = roots.iter().find(|(_, a)| *a == AssetIndex(2)).unwrap().0;
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
  let r = roots.iter().find(|(_, a)| *a == AssetIndex(2)).unwrap().0;
  assert!(available[r].contains(reachability.class(AssetIndex(3))));
}

fn bundle(graph: AssetGraph<'static>) -> BundleGraph<'static> {
  DefaultBundler::default()
    .bundle(graph, &ParcelOptions::default())
    .unwrap()
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
      &bits(3, [1, 2])
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
    for (root_index, root) in roots.iter() {
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
      .count_ones(..),
    roots.len()
  );
  assert_eq!(reachability.reachable_roots.len(), roots.len() + 1);
}
