use std::sync::Arc;

use parcel_core::{AssetType, BufferContent, Diagnostic, DiagnosticList, Transformer};

use crate::json::json_to_js;

pub struct YamlTransformer {}

impl Transformer for YamlTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    let parsed: serde_json::Value =
      serde_yaml_ng::from_str(code).map_err(|e| Diagnostic::from_message(e.to_string()))?;
    let js = json_to_js(parsed, asset.target.output_format)?;

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}
