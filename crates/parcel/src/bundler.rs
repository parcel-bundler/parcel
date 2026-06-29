use std::{
  any::TypeId,
  collections::{HashMap, VecDeque},
};

use fixedbitset::FixedBitSet;
use glob_match::glob_match;
use parcel_core::{
  Asset, AssetGraph, AssetNode, AssetType, Bundle, BundleBehavior, BundleFlags, BundleGraph,
  Bundler, DependencyFlags, DependencyId, DependencyResolution, DiagnosticList, Environment,
  EnvironmentFlags, ParcelOptions, PathId, Priority, SpecifierType,
};

use crate::library_bundler::LibraryBundler;

#[derive(serde::Deserialize)]
pub struct ManualSharedBundle {
  assets: Vec<String>,
  #[serde(default)]
  types: Vec<AssetType>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBundler {
  #[serde(default)]
  manual_shared_bundles: Vec<ManualSharedBundle>,
}

impl DefaultBundler {
  fn manual_shared_bundle(&self, asset: &Asset, options: &ParcelOptions) -> Option<usize> {
    let path = asset
      .loc
      .url
      .to_file_path()
      .ok()
      .map(|path| path.relative(&options.project_root));
    let Some(path) = path else {
      return None;
    };
    let path = path.to_string_lossy();

    self.manual_shared_bundles.iter().position(|b| {
      if b.types.is_empty() || b.types.contains(&asset.ty) {
        return b.assets.iter().any(|a| glob_match(a, &path));
      }

      false
    })
  }
}

impl Bundler for DefaultBundler {
  fn bundle(
    &self,
    asset_graph: AssetGraph,
    options: &ParcelOptions,
  ) -> Result<BundleGraph, DiagnosticList> {
    if asset_graph.entries.iter().all(|e| {
      asset_graph.assets[e.asset.unwrap()]
        .expect_asset()
        .target
        .flags
        .contains(EnvironmentFlags::IS_LIBRARY)
    }) {
      return LibraryBundler {}.bundle(asset_graph, options);
    }

    let mut bundles = Vec::<Bundle>::new();
    let mut dependency_resolutions = HashMap::new();

    // TODO: does this use too much memory?
    let mut bundle_behaviors = asset_graph
      .assets
      .iter()
      .map(|node| match node {
        AssetNode::Asset(asset) => asset.bundle_behavior,
        AssetNode::Deferred { .. } => BundleBehavior::None,
      })
      .collect::<Vec<_>>();

    // Step 1: Traverse the asset graph and find bundle roots.
    // A bundle root is created for entries, and lazy, parallel, isolated, or inline dependencies.
    let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut entry_bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    for entry in &asset_graph.entries {
      if let Some(asset) = entry.asset {
        bundle_roots.insert(asset);
        entry_bundle_roots.insert(asset);
      }
    }

    for asset_index in 0..asset_graph.assets.len() {
      if let AssetNode::Asset(asset) = &asset_graph.assets[asset_index] {
        if bundle_behaviors[asset_index] != BundleBehavior::None {
          bundle_roots.insert(asset_index);
        }

        for dep_index in 0..asset.dependencies.len() {
          let dep = &asset_graph.assets[asset_index].expect_asset().dependencies[dep_index];
          if dep.bundle_behavior != BundleBehavior::None || dep.priority != Priority::Sync {
            if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
              let bundle_behavior = dep.bundle_behavior;
              if matches!(
                &asset_graph.assets[resolved_asset_index as usize],
                AssetNode::Asset(_)
              ) {
                bundle_roots.insert(resolved_asset_index as usize);
                let target_bundle_behavior = &mut bundle_behaviors[resolved_asset_index as usize];
                if bundle_behavior != BundleBehavior::None
                  && *target_bundle_behavior == BundleBehavior::None
                {
                  *target_bundle_behavior = bundle_behavior;
                }
              }
            }
          }
        }
      }
    }

    // reachable_roots is an array of bit sets for each asset. Each bit set
    // indicates which bundle roots are reachable from that asset synchronously.
    let mut reachable_roots =
      vec![FixedBitSet::with_capacity(bundle_roots.count_ones(..)); asset_graph.assets.len()];

    let mut visited = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut queue = VecDeque::new();
    for (bundle_root_index, bundle_root_asset_index) in bundle_roots.ones().enumerate() {
      visited.clear();
      queue.clear();
      queue.push_back(bundle_root_asset_index);
      visited.insert(bundle_root_asset_index);
      while let Some(asset_index) = queue.pop_front() {
        reachable_roots[asset_index].insert(bundle_root_index);

        if let AssetNode::Asset(asset) = &asset_graph.assets[asset_index] {
          for i in asset.resolved_dependencies() {
            if !visited.contains(i as usize) && !bundle_roots.contains(i as usize) {
              visited.insert(i as usize);
              queue.push_back(i as usize);
            }
          }
        }
      }
    }

    #[derive(Hash, PartialEq, Eq)]
    enum BundleKey<'a> {
      Default {
        reachable_roots: &'a FixedBitSet,
        context: Environment,
        packager: TypeId,
      },
      Manual {
        index: usize,
        packager: TypeId,
      },
    }

    let mut shared_bundles = HashMap::<BundleKey, usize>::new();
    let mut asset_index_to_bundle_index = HashMap::new();

    // Create bundles for each bundle root first.
    for bundle_root_asset_index in bundle_roots.ones() {
      if let AssetNode::Asset(asset) = &asset_graph.assets[bundle_root_asset_index] {
        let bundle = Bundle {
          ty: asset.ty.clone(),
          target: asset.target.clone(),
          bundle_behavior: bundle_behaviors[bundle_root_asset_index],
          flags: if entry_bundle_roots.contains(bundle_root_asset_index) {
            BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME
          } else {
            BundleFlags::empty()
          },
          name: None,
          assets: Vec::new(),
          entry_assets: vec![bundle_root_asset_index],
          main_entry_asset: Some(bundle_root_asset_index),
          referenced_bundles: Vec::new(),
        };

        let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
          BundleKey::Manual {
            index,
            packager: asset.content.type_id(),
          }
        } else {
          BundleKey::Default {
            reachable_roots: &reachable_roots[bundle_root_asset_index],
            context: asset.target.environment, // TODO: other environment properties?
            packager: asset.content.type_id(),
          }
        };

        let bundle_index = bundles.len();
        shared_bundles.insert(key, bundle_index);
        asset_index_to_bundle_index.insert(bundle_root_asset_index, bundle_index);
        bundles.push(bundle);
      }
    }

    // Place assets into bundles, following depth-first order.
    for (asset_index, asset, name) in asset_graph.dfs() {
      let is_bundle_root = bundle_roots.contains(asset_index);
      if !is_bundle_root && reachable_roots[asset_index].is_clear() {
        continue;
      }

      let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
        BundleKey::Manual {
          index,
          packager: asset.content.type_id(),
        }
      } else {
        BundleKey::Default {
          reachable_roots: &reachable_roots[asset_index],
          context: asset.target.environment, // TODO: other environment properties?
          packager: asset.content.type_id(),
        }
      };

      let bundle_index = if let Some(bundle_index) = shared_bundles.get_mut(&key) {
        bundles[*bundle_index].assets.push(asset_index);
        *bundle_index
      } else {
        let bundle = Bundle {
          ty: asset.ty.clone(),
          target: asset.target.clone(),
          bundle_behavior: bundle_behaviors[asset_index],
          flags: if entry_bundle_roots.contains(asset_index) {
            BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME
          } else {
            BundleFlags::empty()
          },
          name,
          assets: vec![asset_index],
          entry_assets: if is_bundle_root {
            vec![asset_index]
          } else {
            Vec::new()
          },
          main_entry_asset: if is_bundle_root {
            Some(asset_index)
          } else {
            None
          },
          referenced_bundles: Vec::new(),
        };

        let bundle_index = bundles.len();
        shared_bundles.insert(key, bundle_index);
        bundles.push(bundle);

        if is_bundle_root {
          asset_index_to_bundle_index.insert(asset_index, bundle_index);
        }

        bundle_index
      };

      // Each reachable root depends on this shared bundle.
      for bundle_root_index in reachable_roots[asset_index].ones() {
        if bundle_root_index != bundle_index {
          bundles[bundle_root_index]
            .referenced_bundles
            .push(bundle_index);
        }
      }
    }

    // Build a reverse map from asset index to the bundle it was placed in.
    let mut asset_to_bundle = HashMap::<usize, usize>::new();
    for (bundle_index, bundle) in bundles.iter().enumerate() {
      for asset_index in &bundle.assets {
        asset_to_bundle.insert(*asset_index, bundle_index);
      }
    }

    for (asset_index, node) in asset_graph.assets.iter().enumerate() {
      if let AssetNode::Asset(asset) = node {
        let source_bundle_index = asset_to_bundle.get(&asset_index).copied();
        for (dep_index, dep) in asset.dependencies.iter().enumerate() {
          if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
            if let Some(&bundle_index) =
              asset_index_to_bundle_index.get(&(resolved_asset_index as usize))
            {
              // A sync non-URL dep targeting a bundle root in a different JS bundle keeps its
              // Asset resolution so the runtime can resolve it via the parcelRequire chain.
              // The target bundle is added to referenced_bundles so it loads synchronously first.
              // Exclude URL-type deps and inline/isolated bundles — those use Bundle resolution
              // so the packager can compute URLs or inline content correctly.
              let is_sync_module_dep = dep.priority == Priority::Sync
                && dep.bundle_behavior == BundleBehavior::None
                && dep.specifier_type != SpecifierType::Url
                && bundles[bundle_index].bundle_behavior == BundleBehavior::None;

              if is_sync_module_dep {
                if let Some(src_bundle_index) = source_bundle_index {
                  if bundle_index != src_bundle_index
                    && !bundles[src_bundle_index]
                      .referenced_bundles
                      .contains(&bundle_index)
                  {
                    bundles[src_bundle_index]
                      .referenced_bundles
                      .push(bundle_index);
                  }
                }
              } else {
                dependency_resolutions.insert(
                  DependencyId {
                    asset: asset_index,
                    dependency: dep_index,
                  },
                  bundle_index as u32,
                );
                if dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME) {
                  bundles[bundle_index].flags |= BundleFlags::NEEDS_STABLE_NAME;
                }
              }
            }
          }
        }
      }
    }

    // println!("{:?}", bundles);
    Ok(BundleGraph {
      asset_graph,
      bundles,
      dependency_resolutions,
      project_root: PathId::root(),
    })
  }
}
