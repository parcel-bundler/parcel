use parcel_resolver::FileSystem;

use super::PluginConfig;
use crate::bundle_graph::BundleGraph;

/// Converts an asset graph into a BundleGraph
///
/// Bundlers accept the entire asset graph and modify it to add bundle nodes that group the assets
/// into output bundles.
///
/// Bundle and optimize run in series and are functionally identitical.
///
pub trait BundlerPlugin<Fs: FileSystem> {
  /// A hook designed to load config necessary for the bundler to operate
  ///
  /// This function will run once, shortly after the plugin is initialised.
  ///
  fn load_config(&mut self, config: &PluginConfig<Fs>) -> Result<(), anyhow::Error>;

  // TODO: Should BundleGraph be AssetGraph or something that contains AssetGraph in the name?
  fn bundle(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error>;

  fn optimize(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  #[derive(Debug)]
  struct TestBundlerPlugin {}

  impl<Fs: FileSystem> BundlerPlugin<Fs> for TestBundlerPlugin {
    fn load_config(&mut self, _config: &PluginConfig<Fs>) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn bundle(&self, _bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn optimize(&self, _bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_dyn() {
    let _bundler: Box<dyn BundlerPlugin<InMemoryFileSystem>> = Box::new(TestBundlerPlugin {});
  }
}
