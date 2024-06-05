use std::path::Path;

use parcel_core::plugin::PluginConfig;
use parcel_core::plugin::Resolution;
use parcel_core::plugin::ResolveContext;
use parcel_core::plugin::ResolverPlugin;

#[derive(Debug)]
pub struct ParcelResolver {}

impl ParcelResolver {
  pub fn resolve_simple<S: AsRef<str>>(_from: &Path, _specifier: S) {
    todo!()
  }
}

impl ResolverPlugin for ParcelResolver {
  fn load_config(&mut self, _config: &PluginConfig) -> Result<(), anyhow::Error> {
    todo!()
  }

  fn resolve(
    &mut self,
    _config: &PluginConfig,
    _ctx: &ResolveContext,
  ) -> Result<Resolution, anyhow::Error> {
    todo!()
  }
}
