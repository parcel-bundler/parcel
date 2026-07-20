use std::{
  any::TypeId,
  collections::{HashMap, VecDeque},
};

use fixedbitset::FixedBitSet;
use glob_match::glob_match;
use parcel_core::{
  Asset, AssetGraph, AssetIndex, AssetType, Bundle, BundleBehavior, BundleFlags, BundleGraph,
  Bundler, DependencyFlags, DependencyId, DiagnosticList, Environment, EnvironmentFlags,
  ParcelOptions, Priority, SpecifierType,
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
  fn bundle<'a>(
    &self,
    asset_graph: AssetGraph<'a>,
    options: &ParcelOptions,
  ) -> Result<BundleGraph<'a>, DiagnosticList> {
    if asset_graph.entries.iter().all(|e| {
      asset_graph
        .asset(asset_graph.resolved_entry(e).unwrap())
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
      .map(|asset| asset.bundle_behavior)
      .collect::<Vec<_>>();

    // Step 1: Traverse the asset graph and find bundle roots.
    // A bundle root is created for entries, and lazy, parallel, isolated, or inline dependencies.
    let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut entry_bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    for entry in asset_graph.entries.iter() {
      if let Some(asset) = asset_graph.resolved_entry(entry) {
        bundle_roots.insert(asset.index());
        entry_bundle_roots.insert(asset.index());
      }
    }

    for index in 0..asset_graph.assets.len() {
      let asset_index = AssetIndex::from_index(index);
      let asset = &asset_graph.asset(asset_index);
      if bundle_behaviors[index] != BundleBehavior::None {
        bundle_roots.insert(index);
      }

      for dep_index in 0..asset.dependencies.len() {
        let dep = &asset_graph.asset(asset_index).dependencies[dep_index];
        if dep.bundle_behavior != BundleBehavior::None || dep.priority != Priority::Sync {
          if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
            let bundle_behavior = dep.bundle_behavior;
            bundle_roots.insert(resolved_asset_index.index());
            let target_bundle_behavior = &mut bundle_behaviors[resolved_asset_index.index()];
            if bundle_behavior != BundleBehavior::None
              && *target_bundle_behavior == BundleBehavior::None
            {
              *target_bundle_behavior = bundle_behavior;
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
      queue.push_back(AssetIndex::from_index(bundle_root_asset_index));
      visited.insert(bundle_root_asset_index);
      while let Some(asset_index) = queue.pop_front() {
        reachable_roots[asset_index.index()].insert(bundle_root_index);

        let asset = &asset_graph.asset(asset_index);
        for index in asset_graph.resolved_dependencies(asset) {
          let i = index.index();
          if !visited.contains(i) && !bundle_roots.contains(i) {
            visited.insert(i);
            queue.push_back(index);
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
      let bundle_root_asset_index = AssetIndex::from_index(bundle_root_asset_index);
      let asset = &asset_graph.asset(bundle_root_asset_index);
      let bundle = Bundle {
        ty: asset.ty.clone(),
        target: asset.target.clone(),
        bundle_behavior: bundle_behaviors[bundle_root_asset_index.index()],
        flags: if entry_bundle_roots.contains(bundle_root_asset_index.index()) {
          BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME
        } else {
          BundleFlags::empty()
        },
        dist_path: None,
        assets: Vec::new(),
        entry_assets: vec![bundle_root_asset_index as AssetIndex],
        main_entry_asset: Some(bundle_root_asset_index as AssetIndex),
        referenced_bundles: Vec::new(),
      };

      let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
        BundleKey::Manual {
          index,
          packager: asset.content.type_id(),
        }
      } else {
        BundleKey::Default {
          reachable_roots: &reachable_roots[bundle_root_asset_index.index()],
          context: asset.target.environment, // TODO: other environment properties?
          packager: asset.content.type_id(),
        }
      };

      let bundle_index = bundles.len();
      shared_bundles.insert(key, bundle_index);
      asset_index_to_bundle_index.insert(bundle_root_asset_index, bundle_index);
      bundles.push(bundle);
    }

    // Place assets into bundles, following depth-first order.
    for (asset_index, asset, name) in asset_graph.dfs() {
      let is_bundle_root = bundle_roots.contains(asset_index.index());
      if !is_bundle_root && reachable_roots[asset_index.index()].is_clear() {
        continue;
      }

      let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
        BundleKey::Manual {
          index,
          packager: asset.content.type_id(),
        }
      } else {
        BundleKey::Default {
          reachable_roots: &reachable_roots[asset_index.index()],
          context: asset.target.environment, // TODO: other environment properties?
          packager: asset.content.type_id(),
        }
      };

      let bundle_index = if let Some(bundle_index) = shared_bundles.get_mut(&key) {
        bundles[*bundle_index]
          .assets
          .push(asset_index as AssetIndex);
        *bundle_index
      } else {
        let bundle = Bundle {
          ty: asset.ty.clone(),
          target: asset.target.clone(),
          bundle_behavior: bundle_behaviors[asset_index.index()],
          flags: if entry_bundle_roots.contains(asset_index.index()) {
            BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME
          } else {
            BundleFlags::empty()
          },
          dist_path: name,
          assets: vec![asset_index as AssetIndex],
          entry_assets: if is_bundle_root {
            vec![asset_index as AssetIndex]
          } else {
            Vec::new()
          },
          main_entry_asset: if is_bundle_root {
            Some(asset_index as AssetIndex)
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
      for bundle_root_index in reachable_roots[asset_index.index()].ones() {
        if bundle_root_index != bundle_index {
          bundles[bundle_root_index]
            .referenced_bundles
            .push(bundle_index);
        }
      }
    }

    // Build a reverse map from asset index to the bundle it was placed in.
    let mut asset_to_bundle = HashMap::<AssetIndex, usize>::new();
    for (bundle_index, bundle) in bundles.iter().enumerate() {
      for asset_index in &bundle.assets {
        asset_to_bundle.insert(*asset_index, bundle_index);
      }
    }

    for (asset_index, asset) in asset_graph.assets.iter().enumerate() {
      let asset_index = AssetIndex::from_index(asset_index);
      let source_bundle_index = asset_to_bundle.get(&asset_index).copied();
      for (dep_index, dep) in asset.dependencies.iter().enumerate() {
        if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
          if let Some(&bundle_index) = asset_index_to_bundle_index.get(&resolved_asset_index) {
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
                  asset: asset_index as AssetIndex,
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

    // println!("{:?}", bundles);
    Ok(BundleGraph::new(
      asset_graph,
      bundles,
      dependency_resolutions,
      options.project_root,
    ))
  }
}
