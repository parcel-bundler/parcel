use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::plugin::PackageContext;
use parcel_core::plugin::PackagedBundle;
use parcel_core::plugin::PackagerPlugin;
use parcel_core::plugin::PluginContext;

pub struct RpcPackagerPlugin {
  _name: String,
}

impl Debug for RpcPackagerPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcPackagerPlugin")
  }
}

impl RpcPackagerPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcPackagerPlugin {
      _name: plugin.package_name.clone(),
    })
  }
}

impl PackagerPlugin for RpcPackagerPlugin {
  fn package(&self, _ctx: PackageContext) -> Result<PackagedBundle, anyhow::Error> {
    todo!()
  }
}
