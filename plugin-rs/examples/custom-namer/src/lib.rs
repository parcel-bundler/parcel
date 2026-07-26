use std::path::Path;

use parcel_plugin::{Bundle, BundleGraph, Diagnostic, Options, Plugin, register_plugin};

struct CustomNamer;

impl Plugin for CustomNamer {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(CustomNamer)
  }

  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _options: &Options,
  ) -> Result<Option<String>, Diagnostic> {
    let Some(entry) = bundle.main_entry_asset() else {
      return Ok(None);
    };
    let Some(asset) = bundle_graph.asset(entry) else {
      return Ok(None);
    };
    let file_path = asset.file_path();
    let stem = Path::new(&file_path)
      .file_stem()
      .and_then(|stem| stem.to_str())
      .unwrap_or("bundle");
    Ok(Some(format!("rust-{}.{}", stem, bundle.asset_type())))
  }
}

register_plugin!(CustomNamer);
