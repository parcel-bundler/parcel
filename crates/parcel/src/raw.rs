use parcel_core::{DiagnosticList, Transformer};

pub struct RawTransformer {}

impl Transformer for RawTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _ctx: &parcel_core::PluginContext,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    asset.bundle_behavior = parcel_core::BundleBehavior::Isolated;
    Ok(asset)
  }
}
