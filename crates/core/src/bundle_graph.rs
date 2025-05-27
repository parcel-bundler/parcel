use std::collections::HashMap;

use fixedbitset::FixedBitSet;
use petgraph::{
  Direction,
  graph::{DiGraph, NodeIndex},
  visit::{Control, Dfs, DfsEvent, DfsPostOrder, depth_first_search},
};

use crate::{
  AssetFlags, BundleBehavior, DependencyFlags, Priority, asset,
  asset_graph::{AssetGraph, AssetGraphNode},
  bundle::{Bundle, BundleFlags},
};

pub struct BundleGraph {
  asset_graph: AssetGraph,
  bundles: Vec<Bundle>,
}

fn bundle(asset_graph: AssetGraph) -> BundleGraph {
  let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
  let mut bundle_groups = FixedBitSet::with_capacity(asset_graph.assets.len());
  let mut asset_index_to_node = vec![NodeIndex::new(0); asset_graph.assets.len()];

  // Step 1: Traverse the asset graph and find bundle roots.
  // A bundle root is created for lazy, parallel, isolated, or inline dependencies.
  let mut dfs = Dfs::new(&asset_graph.graph, NodeIndex::new(0));
  while let Some(node) = dfs.next(&asset_graph.graph) {
    match &asset_graph.graph[node] {
      AssetGraphNode::Root => {}
      AssetGraphNode::Entry => {}
      AssetGraphNode::Asset(asset_index) => {
        asset_index_to_node[*asset_index] = node;
      }
      AssetGraphNode::Dependency(dep_index) => {
        let dep = &asset_graph.dependencies[*dep_index].dependency;
        let assets = asset_graph.dependency_assets(node);

        for (asset_index, asset) in assets {
          if dep.priority == Priority::Lazy
            || (dep.priority != Priority::Parallel
              && (dep.bundle_behavior == BundleBehavior::Isolated
                || asset.bundle_behavior == BundleBehavior::Isolated))
          {
            // TODO: create bundle group + bundle
            bundle_roots.insert(asset_index);
            bundle_groups.insert(asset_index);
          } else if dep.priority == Priority::Parallel
            || asset.bundle_behavior == BundleBehavior::Inline
          {
            // TODO: create bundle
            bundle_roots.insert(asset_index);
          }
        }
      }
    }
  }

  let bundle_roots_vec = bundle_roots.ones().collect::<Vec<usize>>();

  let mut bundle_graph = DiGraph::<usize, Priority>::new();
  let mut asset_index_to_bundle_root_index = HashMap::with_capacity(bundle_roots_vec.len());
  let mut bundles = Vec::new();

  for asset_index in &bundle_roots_vec {
    let asset = &asset_graph.assets[*asset_index];
    let deps = asset_graph.incoming_dependencies(asset_index_to_node[*asset_index]);
    let mut bundle_behavior = asset.bundle_behavior;
    let mut flags = BundleFlags::empty();
    for (_, dep) in deps {
      if bundle_behavior == BundleBehavior::None && dep.bundle_behavior != BundleBehavior::None {
        bundle_behavior = dep.bundle_behavior;
      }

      if dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME) {
        flags |= BundleFlags::NEEDS_STABLE_NAME; // TODO: inline?
      }
    }

    let bundle = Bundle {
      ty: asset.ty.clone(),
      env: asset.env.clone(),
      bundle_behavior,
      flags,
      assets: vec![*asset_index],
      entry_assets: vec![*asset_index],
      main_entry_asset: Some(*asset_index),
      name: None,
    };

    let bundle_index = bundles.len();
    bundles.push(bundle);

    bundle_graph.add_node(*asset_index);
    asset_index_to_bundle_root_index.insert(bundle_index, *asset_index);
  }

  // Each bundle is the set of assets that are reachable from the root, minus things that are available above it.

  // reachable_roots is an array of bit sets for each asset. Each bit set
  // indicates which bundle roots are reachable from that asset synchronously.
  let mut reachable_roots =
    vec![FixedBitSet::with_capacity(bundle_roots.len()); asset_graph.assets.len()];

  // reachable_assets is the inverse mapping of reachable_roots. For each bundle root,
  // it contains a bit set that indicates which assets are reachable from it.
  // let mut reachable_assets = Vec::with_capacity(bundle_roots.len());
  let mut reachable_assets =
    vec![FixedBitSet::with_capacity(asset_graph.assets.len()); bundle_roots.len()];

  // ancestor_assets maps bundle roots to the set of all assets available to it at runtime,
  // including in earlier parallel bundles. These are intersected through all paths to
  // the bundle to ensure that the available assets are always present no matter in which
  // order the bundles are loaded.
  // let mut ancestor_assets = Vec::with_capacity(bundle_roots.len());

  for (bundle_root_index, bundle_root_asset_index) in bundle_roots_vec.iter().enumerate() {
    // reachable_assets.push(FixedBitSet::with_capacity(asset_graph.assets.len()));
    // ancestor_assets.push(FixedBitSet::with_capacity(asset_graph.assets.len()));

    depth_first_search(
      &asset_graph.graph,
      Some(asset_index_to_node[*bundle_root_asset_index]),
      |event| {
        if let DfsEvent::Discover(node, _) = event {
          match &asset_graph.graph[node] {
            AssetGraphNode::Root => {}
            AssetGraphNode::Entry => {}
            AssetGraphNode::Asset(asset_index) => {
              if bundle_roots.contains(*asset_index) {
                return Control::<()>::Prune;
              }

              reachable_assets[bundle_root_index].insert(*asset_index);
              reachable_roots[*asset_index].insert(bundle_root_index);
            }
            AssetGraphNode::Dependency(dep_index) => {
              let dep = &asset_graph.dependencies[*dep_index].dependency;
              let assets = asset_graph.dependency_assets(node);

              for (asset_index, _) in assets {
                if bundle_roots.contains(asset_index) {
                  bundle_graph.add_edge(
                    NodeIndex::new(bundle_root_index),
                    NodeIndex::new(asset_index_to_bundle_root_index[&asset_index]),
                    dep.priority,
                  );
                }
              }
            }
          }
        }

        Control::Continue
      },
    );
  }

  let mut ancestor_assets =
    vec![FixedBitSet::with_capacity(asset_graph.assets.len()); bundle_roots.len()];

  let mut dfs = Dfs::new(
    &bundle_graph,
    NodeIndex::new(asset_index_to_bundle_root_index[&0]),
  );
  while let Some(node) = dfs.next(&bundle_graph) {}

  BundleGraph {
    asset_graph,
    bundles: Vec::new(),
  }
}
