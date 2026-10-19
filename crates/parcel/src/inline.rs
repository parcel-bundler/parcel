use parcel_core::{DiagnosticList, Transformer};

pub struct InlineTransformer {}

impl Transformer for InlineTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _ctx: &parcel_core::PluginContext,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    asset.bundle_behavior = parcel_core::BundleBehavior::Inline;
    Ok(asset)
  }
}
