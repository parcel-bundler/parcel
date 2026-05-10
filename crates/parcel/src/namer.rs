use std::{
  ffi::OsStr,
  hash::Hash,
  path::{Component, PathBuf},
};

use parcel_core::{
  Asset, AssetGraph, AssetNode, AssetType, Bundle, BundleFlags, DiagnosticList, EnvironmentFlags,
  Namer, OutputFormat,
};
use xxhash_rust::xxh3::Xxh3Default;

pub struct DefaultNamer {}

impl Namer for DefaultNamer {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &parcel_core::Bundle,
    _options: &parcel_core::ParcelOptions,
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
      if let AssetNode::Asset(asset) = &asset_graph.assets[entry] {
        if bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          let relative = relative_path(asset, bundle).with_extension("");
          let name = relative.to_str().unwrap();
          return Ok(Some(format_name(asset_graph, bundle, name, ext)));
        } else {
          let file_path = asset.loc.url.to_file_path().unwrap();
          let name = file_path.file_prefix().unwrap().to_str().unwrap();
          return Ok(Some(format_name(asset_graph, bundle, name, ext)));
        }
      }
    }

    Ok(Some(format!(
      "{:016x}.{}",
      hash_bundle(asset_graph, bundle),
      ext
    )))
  }
}

fn hash_bundle(asset_graph: &AssetGraph, bundle: &Bundle) -> u64 {
  let mut hash = Xxh3Default::new();
  for asset in &bundle.assets {
    if let AssetNode::Asset(asset) = &asset_graph.assets[*asset] {
      asset.loc.hash(&mut hash);
      asset.target.hash(&mut hash);
    }
  }

  hash.digest()
}

fn relative_path(asset: &Asset, bundle: &Bundle) -> PathBuf {
  let path = asset.loc.url.to_file_path().unwrap();
  pathdiff::diff_paths(
    path,
    bundle
      .target
      .dist_dir
      .to_file_path()
      .unwrap()
      .parent()
      .unwrap(),
  )
  .unwrap()
  .components()
  .map(|c| match c {
    Component::ParentDir => Component::Normal(OsStr::new("up")),
    _ => c,
  })
  .collect()
}

fn format_name(asset_graph: &AssetGraph, bundle: &Bundle, name: &str, ext: &str) -> String {
  if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
    format!("{}.{}", name, ext)
  } else {
    format!("{}-{:016x}.{}", name, hash_bundle(asset_graph, bundle), ext)
  }
}
