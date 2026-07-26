use std::{collections::HashMap, hash::Hash};

use parcel_core::{
  AssetGraph, AssetIndex, Bundle, BundleFlags, BundleGraph, Bundler, ContentType, DependencyId,
  DiagnosticList, ParcelOptions, SourceUrl, Target,
};

pub struct LibraryBundler {}

impl Bundler for LibraryBundler {
  fn bundle<'a>(
    &self,
    asset_graph: AssetGraph<'a>,
    options: &ParcelOptions,
  ) -> Result<BundleGraph<'a>, DiagnosticList> {
    #[derive(Hash, PartialEq, Eq)]
    struct BundleKey<'a> {
      url: &'a SourceUrl,
      ty: ContentType,
      target: &'a Target,
    }

    let mut bundles = Vec::<Bundle>::new();
    let mut bundles_by_path = HashMap::<BundleKey, usize>::new();
    let mut asset_to_bundle = HashMap::new();
    let mut dependency_resolutions = HashMap::new();

    for (id, asset, name) in asset_graph.dfs() {
      let key = BundleKey {
        url: &asset.loc.url,
        ty: asset.content.ty(),
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
          dist_path: name,
          referenced_bundles: Vec::new(),
        });
        bundles_by_path.insert(key, bundle_index);
        bundle_index
      };
      asset_to_bundle.insert(id, bundle_index);
    }

    for (id, asset) in asset_graph.assets.iter().enumerate() {
      for (dep_index, dep) in asset.dependencies.iter().enumerate() {
        if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
          if let Some(bundle) = asset_to_bundle.get(&resolved_asset_index) {
            dependency_resolutions.insert(
              DependencyId {
                asset: AssetIndex(id as u32),
                dependency: dep_index,
              },
              *bundle as u32,
            );
          }
        }
      }
    }

    for entry in asset_graph.entries.iter() {
      if let Some(asset_index) = asset_graph.resolved_entry(entry) {
        if let Some(bundle) = asset_to_bundle.get(&asset_index) {
          bundles[*bundle].flags |= BundleFlags::ENTRY;
        }
      }
    }

    Ok(BundleGraph::new(
      asset_graph,
      bundles,
      dependency_resolutions,
      options.project_root,
    ))
  }
}
