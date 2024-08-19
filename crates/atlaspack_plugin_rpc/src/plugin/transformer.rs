use std::fmt;
use std::fmt::Debug;

use anyhow::Error;

use atlaspack_config::PluginNode;
use atlaspack_core::plugin::PluginContext;
use atlaspack_core::plugin::TransformerPlugin;
use atlaspack_core::plugin::{TransformResult, TransformationInput};

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
  fn transform(&mut self, _asset: TransformationInput) -> Result<TransformResult, Error> {
    todo!()
  }
}
