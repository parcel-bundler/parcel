use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;

#[derive(Debug)]
pub struct PluginReporterRpc {
  name: String,
}

impl PluginReporterRpc {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Self {
    PluginReporterRpc {
      name: plugin.package_name.clone(),
    }
  }
}

impl ReporterPlugin for PluginReporterRpc {
  fn report(&self, event: ReporterEvent) -> Result<(), anyhow::Error> {
    todo!()
  }
}
