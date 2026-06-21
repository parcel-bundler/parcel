use std::sync::Arc;

use parcel_core::{AssetType, BufferContent, Diagnostic, DiagnosticList, Transformer};

use crate::json::json_to_js;

pub struct TomlTransformer {}

impl Transformer for TomlTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    let parsed: serde_json::Value =
      toml::from_str(code).map_err(|e| Diagnostic::from_message(e.to_string()))?;
    let js = json_to_js(parsed, asset.target.output_format)?;

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}
