use std::{
  ffi::OsStr,
  hash::Hash,
  path::{Component, Path, PathBuf},
};

use parcel_core::{
  Asset, AssetGraph, AssetNode, AssetType, Bundle, BundleFlags, BundleGraph, Diagnostic,
  DiagnosticList, EnvironmentFlags, Namer, OutputFormat, SourceUrl,
};
use xxhash_rust::xxh3::Xxh3Default;

pub struct DefaultNamer {}

impl Namer for DefaultNamer {
  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &parcel_core::Bundle,
    options: &parcel_core::ParcelOptions,
  ) -> Result<Option<String>, DiagnosticList> {
    let mut ext = bundle.ty.extension();
    if bundle.ty == AssetType::Js
      && bundle
        .target
        .flags
        .contains(EnvironmentFlags::MODULE_TYPE_EXTENSION)
    {
      if bundle.target.output_format == OutputFormat::Esmodule {
        ext = "mjs";
      } else if bundle.target.output_format == OutputFormat::Commonjs {
        ext = "cjs";
      }
    }

    if let Some(entry) = bundle.main_entry_asset {
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[entry] {
        if bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          let relative = relative_path(
            asset,
            &bundle.target.dist_dir.to_file_path()?.parent().unwrap(),
          )?
          .with_extension("");
          let name = relative.to_str().unwrap();
          return Ok(Some(format_name(
            &bundle_graph.asset_graph,
            bundle,
            name,
            ext,
            &options.project_root,
          )));
        } else {
          if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
            let entry_root = common_root_path(
              bundle_graph
                .bundles
                .iter()
                .filter(|b| {
                  b.flags.contains(BundleFlags::NEEDS_STABLE_NAME)
                    && b.main_entry_asset.is_some()
                    && b.target.dist_dir == bundle.target.dist_dir
                })
                .map(|b| {
                  bundle_graph.asset_graph.assets[b.main_entry_asset.unwrap()]
                    .expect_asset()
                    .loc
                    .url
                    .to_file_path()
                    .unwrap()
                }),
            );
            if let Some(entry_root) = entry_root {
              let relative = relative_path(asset, &entry_root)?.with_extension("");
              let name = relative.to_str().unwrap();
              return Ok(Some(format_name(
                &bundle_graph.asset_graph,
                bundle,
                name,
                ext,
                &options.project_root,
              )));
            }
          }

          let file_path = asset.loc.url.to_file_path()?;
          let name = file_path.file_prefix().unwrap().to_str().unwrap();
          return Ok(Some(format_name(
            &bundle_graph.asset_graph,
            bundle,
            name,
            ext,
            &options.project_root,
          )));
        }
      }
    }

    Ok(Some(format!(
      "{:016x}.{}",
      hash_bundle(&bundle_graph.asset_graph, bundle, &options.project_root),
      ext
    )))
  }
}

fn hash_bundle(asset_graph: &AssetGraph, bundle: &Bundle, project_root: &SourceUrl) -> u64 {
  let mut hash = Xxh3Default::new();
  for asset in &bundle.assets {
    if let AssetNode::Asset(asset) = &asset_graph.assets[*asset] {
      asset.loc.url.relative(project_root).hash(&mut hash);
      asset.loc.start.hash(&mut hash);
      asset.loc.end.hash(&mut hash);
      // Hash Target fields portably: relativize dist_dir and loc.url.
      let t = &asset.target;
      t.environment.hash(&mut hash);
      t.output_format.hash(&mut hash);
      t.source_type.hash(&mut hash);
      t.flags.hash(&mut hash);
      t.source_map.hash(&mut hash);
      if let Some(loc) = &t.loc {
        loc.url.relative(project_root).hash(&mut hash);
        loc.start.hash(&mut hash);
        loc.end.hash(&mut hash);
      }
      t.include_node_modules.hash(&mut hash);
      t.engines.hash(&mut hash);
      t.dist_dir.relative(project_root).hash(&mut hash);
      t.public_url.hash(&mut hash);
    }
  }

  hash.digest()
}

fn relative_path(asset: &Asset, from: &Path) -> Result<PathBuf, Diagnostic> {
  let path = asset.loc.url.to_file_path()?;
  Ok(
    pathdiff::diff_paths(path, from)
      .unwrap()
      .components()
      .map(|c| match c {
        Component::ParentDir => Component::Normal(OsStr::new("up")),
        _ => c,
      })
      .collect(),
  )
}

fn format_name(
  asset_graph: &AssetGraph,
  bundle: &Bundle,
  name: &str,
  ext: &str,
  project_root: &SourceUrl,
) -> String {
  if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
    format!("{}.{}", name, ext)
  } else {
    format!(
      "{}-{:016x}.{}",
      name,
      hash_bundle(asset_graph, bundle, project_root),
      ext
    )
  }
}

fn common_root_path(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
  let mut path_iter = paths.into_iter();
  let mut root = path_iter.next()?.parent()?.to_path_buf();

  for path in path_iter {
    let mut new_root = PathBuf::new();
    let mut found = false;
    for (a, b) in root.components().zip(path.parent()?.components()) {
      if a == b {
        found = true;
        new_root.push(a);
      } else {
        break;
      }
    }
    root = new_root;
    if !found {
      return None;
    }
  }

  Some(root)
}
