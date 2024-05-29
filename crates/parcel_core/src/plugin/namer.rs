use std::path::PathBuf;

use super::PluginConfig;
use crate::bundle_graph::BundleGraph;
use crate::types::Bundle;

/// Determines the output filename for a bundle
///
/// Namers run in a pipeline until one returns a result.
///
pub trait NamerPlugin {
  /// A hook designed to setup config needed for naming bundles
  ///
  /// This function will run once, shortly after the plugin is initialised.
  ///
  fn load_config(&mut self, config: &PluginConfig) -> Result<(), anyhow::Error>;

  /// Names the given bundle
  ///
  /// The returned file path should be relative to the target dist directory, and will be used to
  /// name the bundle. Naming can be forwarded onto the next plugin by returning None.
  ///
  fn name(
    &mut self,
    config: &PluginConfig,
    bundle: &Bundle,
    bundle_graph: &BundleGraph,
  ) -> Result<Option<PathBuf>, anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;

  struct TestNamerPlugin {}

  impl NamerPlugin for TestNamerPlugin {
    fn load_config(&mut self, _config: &PluginConfig) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn name(
      &mut self,
      _config: &PluginConfig,
      _bundle: &Bundle,
      _bundle_graph: &BundleGraph,
    ) -> Result<Option<PathBuf>, anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut namers = Vec::<Box<dyn NamerPlugin>>::new();

    namers.push(Box::new(TestNamerPlugin {}));

    assert_eq!(namers.len(), 1);
  }
}
