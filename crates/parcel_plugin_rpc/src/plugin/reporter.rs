use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;

#[derive(Debug)]
pub struct RpcReporterPlugin {
  name: String,
}

impl RpcReporterPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Self {
    RpcReporterPlugin {
      name: plugin.package_name.clone(),
    }
  }
}

impl ReporterPlugin for RpcReporterPlugin {
  fn report(&self, event: ReporterEvent) -> Result<(), anyhow::Error> {
    todo!()
  }
}
