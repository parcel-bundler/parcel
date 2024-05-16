use std::fs::File;

use parcel_resolver::FileSystem;

use super::PluginConfig;
use crate::bundle_graph::BundleGraph;
use crate::types::Bundle;
use crate::types::SourceMap;

pub struct PackageContext<'a> {
  pub bundle: &'a Bundle,
  pub bundle_graph: &'a BundleGraph,
  pub contents: &'a File, // TODO We may want this to be a String or File later
  pub map: Option<&'a SourceMap>,
  // TODO getSourceMapReference?
}

pub struct PackagedBundle {
  pub contents: File,
  // TODO ast, map, type
}

/// Combines all the assets in a bundle together into an output file
///
/// Packagers are also responsible for resolving URL references, bundle inlining, and generating
/// source maps.
///
pub trait PackagerPlugin<Fs: FileSystem>: Send + Sync {
  /// A hook designed to setup config needed for packaging
  ///
  /// This function will run once, shortly after the plugin is initialised.
  ///
  fn load_config(&mut self, config: &PluginConfig<Fs>) -> Result<(), anyhow::Error>;

  /// Combines assets in a bundle
  fn package(
    &mut self,
    config: &PluginConfig<Fs>,
    package_context: PackageContext,
  ) -> Result<PackagedBundle, anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  struct TestPackagerPlugin {}

  impl<Fs: FileSystem> PackagerPlugin<Fs> for TestPackagerPlugin {
    fn load_config(&mut self, _config: &PluginConfig<Fs>) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn package(
      &mut self,
      _config: &PluginConfig<Fs>,
      _package_context: PackageContext,
    ) -> Result<PackagedBundle, anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_dyn() {
    let _packager: Box<dyn PackagerPlugin<InMemoryFileSystem>> = Box::new(TestPackagerPlugin {});
  }
}
