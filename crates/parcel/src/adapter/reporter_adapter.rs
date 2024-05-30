use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;

use super::Adapter;

#[derive(Debug)]
pub struct ReporterAdapter {
  name: String,
}

impl ReporterAdapter {
  pub fn new(adapter: Arc<dyn Adapter>, ctx: &PluginContext, plugin: &PluginNode) -> Self {
    ReporterAdapter {
      name: plugin.package_name.clone(),
    }
  }
}

impl ReporterPlugin for ReporterAdapter {
  fn report(&self, event: ReporterEvent) -> Result<(), anyhow::Error> {
    todo!()
  }
}
