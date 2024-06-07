use parcel_config::PluginNode;
use parcel_core::plugin::PackageContext;
use parcel_core::plugin::PackagedBundle;
use parcel_core::plugin::PackagerPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct PluginPackagerRpc {
  name: String,
}

impl PluginPackagerRpc {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(PluginPackagerRpc {
      name: plugin.package_name.clone(),
    })
  }
}

impl PackagerPlugin for PluginPackagerRpc {
  fn package(&self, ctx: PackageContext) -> Result<PackagedBundle, anyhow::Error> {
    todo!()
  }
}
