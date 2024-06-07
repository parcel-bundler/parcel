use parcel_config::PluginNode;
use parcel_core::plugin::PackageContext;
use parcel_core::plugin::PackagedBundle;
use parcel_core::plugin::PackagerPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct RpcPackagerPlugin {
  name: String,
}

impl RpcPackagerPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Result<Self, anyhow::Error> {
    Ok(RpcPackagerPlugin {
      name: plugin.package_name.clone(),
    })
  }
}

impl PackagerPlugin for RpcPackagerPlugin {
  fn package(&self, ctx: PackageContext) -> Result<PackagedBundle, anyhow::Error> {
    todo!()
  }
}
