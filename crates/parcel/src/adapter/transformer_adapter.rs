use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::plugin::GenerateOutput;
use parcel_core::plugin::PluginConfig;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolve;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::AST;
use parcel_core::types::Asset;

use super::Adapter;

#[derive(Debug)]
pub struct TransformerAdapter {
  name: String,
}

impl TransformerAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(TransformerAdapter {
      name: plugin.package_name.clone(),
    })
  }
}

impl TransformerPlugin for TransformerAdapter {
  fn can_reuse_ast(&self, ast: AST) -> bool {
    todo!()
  }

  fn parse(
    &mut self,
    config: &PluginConfig,
    asset: &Asset,
    resolve: &Resolve,
  ) -> Result<AST, anyhow::Error> {
    todo!()
  }

  fn transform(
    &mut self,
    config: &PluginConfig,
    asset: &mut Asset,
    resolve: &Resolve,
  ) -> Result<Vec<Asset>, anyhow::Error> {
    todo!()
  }

  fn post_process(
    &mut self,
    config: &PluginConfig,
    assets: Vec<&Asset>,
  ) -> Result<Vec<Asset>, anyhow::Error> {
    todo!()
  }

  fn generate(&self, asset: Asset, ast: AST) -> Result<GenerateOutput, anyhow::Error> {
    todo!()
  }
}
