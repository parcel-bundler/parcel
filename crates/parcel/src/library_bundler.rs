use std::{
  collections::{HashMap, HashSet},
  hash::Hash,
};

use parcel_core::{
  AssetGraph, AssetIndex, Bundle, BundleFlags, BundleGraph, BundleGraphDependencyResolution,
  Bundler, ContentType, DependencyId, DiagnosticList, ParcelOptions, SourceUrl, Target,
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
          id: asset.id_u64(&options.project_root),
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
          name_state: Default::default(),
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
              BundleGraphDependencyResolution::Bundle {
                bundle_index: *bundle as u32,
                asset_index: resolved_asset_index,
              },
            );
          }
        }
      }
    }

    // Entries that resolve to the same asset share its transformed code, but each requested dist
    // path still needs its own output. The dfs only names the bundle for the first entry to reach
    // an asset, so name the rest here, adding a bundle per extra dist path. These are packaged
    // separately because the contents depend on the location (e.g. relative imports and source
    // map URLs). Dependencies keep resolving to the first bundle.
    let mut seen = HashSet::new();
    for entry in asset_graph.entries.iter() {
      let Some(asset_index) = asset_graph.resolved_entry(entry) else {
        continue;
      };
      let Some(&bundle_index) = asset_to_bundle.get(&asset_index) else {
        continue;
      };

      let bundle = &mut bundles[bundle_index];
      bundle.flags |= BundleFlags::ENTRY;
      let Some(dist_entry) = entry.dist_entry else {
        continue;
      };

      match bundle.dist_path {
        None => {
          bundle.dist_path = Some(dist_entry);
          bundle.flags |= BundleFlags::NEEDS_STABLE_NAME;
        }
        Some(dist_path) if dist_path != dist_entry && seen.insert((bundle_index, dist_entry)) => {
          let mut hasher = xxhash_rust::xxh3::Xxh3Default::new();
          bundle.id.hash(&mut hasher);
          dist_entry
            .relative(&bundle.target.dist_dir)
            .hash(&mut hasher);
          let alias = Bundle {
            id: hasher.digest(),
            ty: bundle.ty.clone(),
            target: bundle.target.clone(),
            bundle_behavior: bundle.bundle_behavior,
            flags: bundle.flags,
            dist_path: Some(dist_entry),
            assets: bundle.assets.clone(),
            entry_assets: bundle.entry_assets.clone(),
            main_entry_asset: bundle.main_entry_asset,
            referenced_bundles: Vec::new(),
            name_state: Default::default(),
          };
          bundles.push(alias);
        }
        _ => {}
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
