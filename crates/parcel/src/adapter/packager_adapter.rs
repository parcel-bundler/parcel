use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::plugin::PackageContext;
use parcel_core::plugin::PackagedBundle;
use parcel_core::plugin::PackagerPlugin;
use parcel_core::plugin::PluginContext;

use super::Adapter;

#[derive(Debug)]
pub struct PackagerAdapter {
  name: String,
}

impl PackagerAdapter {
  pub fn new(
    adapter: Arc<dyn Adapter>,
    ctx: &PluginContext,
    plugin: &PluginNode,
  ) -> Result<Self, anyhow::Error> {
    Ok(PackagerAdapter {
      name: plugin.package_name.clone(),
    })
  }
}

impl PackagerPlugin for PackagerAdapter {
  fn package(&self, ctx: PackageContext) -> Result<PackagedBundle, anyhow::Error> {
    todo!()
  }
}
