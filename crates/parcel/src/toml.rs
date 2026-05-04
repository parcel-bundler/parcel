use std::sync::Arc;

use parcel_core::{AssetType, BufferContent, DiagnosticList, Transformer};

pub struct TomlTransformer {}

impl Transformer for TomlTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    let parsed: serde_json::Value = toml::from_str(code).unwrap();
    let json = serde_json::to_string(&parsed).unwrap();
    let js = format!("module.exports = {};\n", json);

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}
