use std::sync::Arc;

use parcel_core::{AssetType, BufferContent, DiagnosticList, Transformer};

pub struct JsonTransformer {}

impl Transformer for JsonTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    // let json: serde_json::Value = serde_json::from_str(code)?;
    let js = format!("export default {};\n", code);

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
    Ok(asset)
  }
}
