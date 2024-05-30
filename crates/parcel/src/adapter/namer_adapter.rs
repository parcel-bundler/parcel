use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::bundle_graph::BundleGraph;
use parcel_core::plugin::NamerPlugin;
use parcel_core::plugin::PluginContext;
use parcel_core::types::Bundle;

use super::Adapter;

#[derive(Debug)]
pub struct NamerAdapter {
  name: String,
}

impl NamerAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(NamerAdapter {
      name: plugin.package_name.clone(),
    })
  }
}

impl NamerPlugin for NamerAdapter {
  fn name(
    &self,
    bundle: &Bundle,
    bundle_graph: &BundleGraph,
  ) -> Result<Option<std::path::PathBuf>, anyhow::Error> {
    todo!()
  }
}
