use parcel_core::plugin::GenerateOutput;
use parcel_core::plugin::PluginConfig;
use parcel_core::plugin::Resolve;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::AST;
use parcel_core::types::Asset;

#[derive(Debug)]
pub struct ParcelTransformerJs {}

impl TransformerPlugin for ParcelTransformerJs {
  fn load_config(&mut self, _config: &PluginConfig) -> Result<(), anyhow::Error> {
    todo!()
  }

  fn can_reuse_ast(&self, _ast: AST) -> bool {
    todo!()
  }

  fn parse(
    &mut self,
    _config: &PluginConfig,
    _asset: &Asset,
    _resolve: &Resolve,
  ) -> Result<AST, anyhow::Error> {
    todo!()
  }

  fn transform(
    &mut self,
    _config: &PluginConfig,
    _asset: &mut Asset,
    _resolve: &Resolve,
  ) -> Result<Vec<Asset>, anyhow::Error> {
    todo!()
  }

  fn post_process(
    &mut self,
    _config: &PluginConfig,
    _assets: Vec<&Asset>,
  ) -> Result<Vec<Asset>, anyhow::Error> {
    todo!()
  }

  fn generate(&self, _asset: Asset, _ast: AST) -> Result<GenerateOutput, anyhow::Error> {
    todo!()
  }
}
