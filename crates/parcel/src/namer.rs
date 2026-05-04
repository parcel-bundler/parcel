use std::{
  ffi::OsStr,
  hash::Hash,
  path::{Component, PathBuf},
};

use parcel_core::{
  AssetGraph, AssetNode, AssetType, BundleFlags, DiagnosticList, EnvironmentFlags, Namer,
  OutputFormat,
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
    if bundle.ty == AssetType::Js && bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
      if bundle.target.output_format == OutputFormat::Esmodule {
        ext = "mjs";
      } else if bundle.target.output_format == OutputFormat::Commonjs {
        ext = "cjs";
      }
    }

    if bundle.flags.contains(BundleFlags::NEEDS_STABLE_NAME) {
      if let Some(entry) = bundle.main_entry_asset {
        if let AssetNode::Asset(asset) = &asset_graph.assets[entry] {
          let path = asset.loc.url.to_file_path().unwrap().with_extension(ext);
          let relative: PathBuf = pathdiff::diff_paths(
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
          .collect();

          return Ok(Some(relative.to_str().unwrap().to_owned()));
        }
      }
    }

    let mut hash = Xxh3Default::new();
    for asset in &bundle.assets {
      if let AssetNode::Asset(asset) = &asset_graph.assets[*asset] {
        asset.loc.hash(&mut hash);
      }
    }
    Ok(Some(format!("{:016x}.{}", hash.digest(), ext)))
  }
}
