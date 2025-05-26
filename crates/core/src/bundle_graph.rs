use fixedbitset::FixedBitSet;
use petgraph::{
  Direction,
  graph::{DiGraph, NodeIndex},
  visit::Dfs,
};

use crate::{
  AssetFlags, BundleBehavior, Priority, asset,
  asset_graph::{AssetGraph, AssetGraphNode},
  bundle::Bundle,
};

pub struct BundleGraph {
  asset_graph: AssetGraph,
  bundles: Vec<Bundle>,
}

fn bundle(asset_graph: AssetGraph) -> BundleGraph {
  let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
  let mut bundle_groups = FixedBitSet::with_capacity(asset_graph.assets.len());
  let mut asset_index_to_node = vec![NodeIndex::new(0); asset_graph.assets.len()];

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

  // Each bundle is the set of assets that are reachable from the root, minus things that are available above it.

  // reachable_roots is an array of bit sets for each asset. Each bit set
  // indicates which bundle roots are reachable from that asset synchronously.
  let mut reachable_roots = Vec::with_capacity(asset_graph.assets.len());
  for _ in 0..asset_graph.assets.len() {
    reachable_roots.push(FixedBitSet::with_capacity(bundle_roots.len()));
  }

  let mut reachable_assets = Vec::with_capacity(bundle_roots.len());
  for _ in 0..bundle_roots.len() {
    reachable_assets.push(FixedBitSet::with_capacity(asset_graph.assets.len()));
  }

  // reachable_assets is the inverse mapping of reachable_roots. For each bundle root,
  // it contains a bit set that indicates which assets are reachable from it.
  // let mut reachable_assets = Vec::with_capacity(bundle_roots.len());

  // ancestor_assets maps bundle roots to the set of all assets available to it at runtime,
  // including in earlier parallel bundles. These are intersected through all paths to
  // the bundle to ensure that the available assets are always present no matter in which
  // order the bundles are loaded.
  // let mut ancestor_assets = Vec::with_capacity(bundle_roots.len());

  for (bundle_root_index, bundle_root_asset_index) in bundle_roots_vec.iter().enumerate() {
    // reachable_assets.push(FixedBitSet::with_capacity(asset_graph.assets.len()));
    // ancestor_assets.push(FixedBitSet::with_capacity(asset_graph.assets.len()));

    let mut dfs = Dfs::new(
      &asset_graph.graph,
      asset_index_to_node[*bundle_root_asset_index],
    );
    while let Some(node) = dfs.next(&asset_graph.graph) {
      match &asset_graph.graph[node] {
        AssetGraphNode::Root => {}
        AssetGraphNode::Entry => {}
        AssetGraphNode::Asset(asset_index) => {
          let asset = &asset_graph.assets[*asset_index];
          // if asset.bundle_behavior != BundleBehavior::None {
          //   break; // TODO skip children
          // }

          // if bundle_roots_bitset.contains(*asset_index) {
          //   reachable_bundle_roots[bundle_root_index].insert();
          // }

          reachable_assets[bundle_root_index].insert(*asset_index);
          reachable_roots[*asset_index].insert(bundle_root_index);
        }
        AssetGraphNode::Dependency(dep_index) => {
          // let dep = &asset_graph.dependencies[*dep_index].dependency;
          // if dep.priority != Priority::Sync {
          //   // TODO??
          // }
        }
      }
    }
  }

  // for (bundle_root_index, bundle_root_asset_index) in bundle_roots.iter().enumerate() {
  //   for reachable_root in reachable_assets[bundle_root_index].ones() {

  //   }
  // }

  for bundle_root in 0..bundle_roots_vec.len() {
    // let mut reachable_roots = reachable_assets[bundle_root].clone();
    // reachable_roots.intersect_with(&bundle_roots);
    // for reachable_root in reachable_roots.ones() {
    //   // reachable_assets[reachable_root].difference_with(&reachable_assets[bundle_root]);
    //   reachable_roots[]
    // }
  }

  BundleGraph {
    asset_graph,
    bundles: Vec::new(),
  }
}
