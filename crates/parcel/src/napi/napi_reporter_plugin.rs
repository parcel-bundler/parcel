use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;

#[derive(Debug)]
pub struct NapiReporterPlugin {
  name: String,
}

impl NapiReporterPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Self {
    NapiReporterPlugin {
      name: plugin.package_name.clone(),
    }
  }
}

impl ReporterPlugin for NapiReporterPlugin {
  fn report(&self, event: ReporterEvent) -> Result<(), anyhow::Error> {
    todo!()
  }
}
