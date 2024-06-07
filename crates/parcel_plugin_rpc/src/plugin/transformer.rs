use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::plugin::GenerateOutput;
use parcel_core::plugin::PluginConfig;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolve;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::AST;
use parcel_core::types::Asset;

pub struct RpcTransformerPlugin {
  _name: String,
}

impl Debug for RpcTransformerPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcTransformerPlugin")
  }
}

impl RpcTransformerPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcTransformerPlugin {
      _name: plugin.package_name.clone(),
    })
  }
}

impl TransformerPlugin for RpcTransformerPlugin {
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
