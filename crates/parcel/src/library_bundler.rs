use std::{any::TypeId, collections::HashMap, hash::Hash};

use parcel_core::{
  AssetGraph, AssetNode, Bundle, BundleFlags, BundleGraph, Bundler, DependencyId,
  DependencyResolution, DiagnosticList, ParcelOptions, PathId, SourceUrl, Target,
};

pub struct LibraryBundler {}

impl Bundler for LibraryBundler {
  fn bundle(
    &self,
    asset_graph: AssetGraph,
    _options: &ParcelOptions,
  ) -> Result<BundleGraph, DiagnosticList> {
    #[derive(Hash, PartialEq, Eq)]
    struct BundleKey<'a> {
      url: &'a SourceUrl,
      ty: TypeId,
      target: &'a Target,
    }

    let mut bundles = Vec::<Bundle>::new();
    let mut bundles_by_path = HashMap::<BundleKey, usize>::new();
    let mut asset_to_bundle = HashMap::new();
    let mut dependency_resolutions = HashMap::new();

    for (id, asset, name) in asset_graph.dfs() {
      let key = BundleKey {
        url: &asset.loc.url,
        ty: asset.content.type_id(),
        target: &asset.target,
      };

      let bundle_index = if let Some(bundle_index) = bundles_by_path.get(&key) {
        bundles[*bundle_index].assets.push(id);
        *bundle_index
      } else {
        let bundle_index = bundles.len();
        bundles.push(Bundle {
          ty: asset.ty.clone(),
          assets: vec![id],
          bundle_behavior: asset.bundle_behavior,
          entry_assets: vec![id],
          target: asset.target.clone(),
          flags: if name.is_some() {
            BundleFlags::NEEDS_STABLE_NAME
          } else {
            BundleFlags::empty()
          },
          main_entry_asset: Some(id),
          name,
          referenced_bundles: Vec::new(),
        });
        bundles_by_path.insert(key, bundle_index);
        bundle_index
      };
      asset_to_bundle.insert(id as u32, bundle_index);
    }

    for (id, node) in asset_graph.assets.iter().enumerate() {
      if let AssetNode::Asset(asset) = node {
        for (dep_index, dep) in asset.dependencies.iter().enumerate() {
          if let DependencyResolution::Asset(resolved_asset_index) = dep.resolution {
            if let Some(bundle) = asset_to_bundle.get(&resolved_asset_index) {
              dependency_resolutions.insert(
                DependencyId {
                  asset: id,
                  dependency: dep_index,
                },
                *bundle as u32,
              );
            }
          }
        }
      }
    }

    for entry in &asset_graph.entries {
      if let Some(asset_index) = entry.asset {
        if let Some(bundle) = asset_to_bundle.get(&(asset_index as u32)) {
          bundles[*bundle].flags |= BundleFlags::ENTRY;
        }
      }
    }

    Ok(BundleGraph {
      asset_graph,
      bundles,
      dependency_resolutions,
      project_root: PathId::root(),
    })
  }
}
