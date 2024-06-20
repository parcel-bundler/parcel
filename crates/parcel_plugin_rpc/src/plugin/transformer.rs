use std::fmt;
use std::fmt::Debug;

use anyhow::Error;

use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::{RunTransformContext, TransformResult, TransformationInput};

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
  fn transform(
    &self,
    _context: &mut RunTransformContext,
    _asset: TransformationInput,
  ) -> Result<TransformResult, Error> {
    todo!()
  }
}
