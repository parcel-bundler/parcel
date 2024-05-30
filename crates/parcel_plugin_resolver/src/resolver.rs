use parcel_core::plugin::PluginContext;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;

#[derive(Debug)]
pub struct ParcelResolver {}

impl ParcelResolver {
  pub fn new(_ctx: &PluginContext) -> Self {
    Self {}
  }
}

impl ResolverPlugin for ParcelResolver {
  fn resolve(&self, _ctx: &ResolveContext) -> Result<Resolution, anyhow::Error> {
    todo!()
  }
}
