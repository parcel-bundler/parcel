use parcel_core::plugin::PluginContext;
use parcel_core::plugin::RunTransformContext;
use parcel_core::plugin::TransformResult;
use parcel_core::plugin::TransformationInput;
use parcel_core::plugin::TransformerPlugin;

#[derive(Debug)]
pub struct ParcelTransformerJs {}

impl ParcelTransformerJs {
  pub fn new(_ctx: &PluginContext) -> Self {
    Self {}
  }
}

impl TransformerPlugin for ParcelTransformerJs {
  fn transform(
    &mut self,
    _context: &mut RunTransformContext,
    _asset: TransformationInput,
  ) -> Result<TransformResult, anyhow::Error> {
    todo!()
  }
}
