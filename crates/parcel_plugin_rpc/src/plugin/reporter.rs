use std::fmt;
use std::fmt::Debug;

use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;

pub struct RpcReporterPlugin {
  _name: String,
}

impl Debug for RpcReporterPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcReporterPlugin")
  }
}

impl RpcReporterPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Self {
    RpcReporterPlugin {
      _name: plugin.package_name.clone(),
    }
  }
}

impl ReporterPlugin for RpcReporterPlugin {
  fn report(&self, _event: &ReporterEvent) -> Result<(), anyhow::Error> {
    // TODO
    Ok(())
  }
}
