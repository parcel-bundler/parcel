use std::fmt::Debug;

use crate::bundle_graph::BundleGraph;

/// Converts an asset graph into a BundleGraph
///
/// Bundlers accept the entire asset graph and modify it to add bundle nodes that group the assets
/// into output bundles.
///
/// Bundle and optimize run in series and are functionally identitical.
///
pub trait BundlerPlugin: Debug {
  // TODO: Should BundleGraph be AssetGraph or something that contains AssetGraph in the name?
  fn bundle(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error>;

  fn optimize(&self, bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug)]
  struct TestBundlerPlugin {}

  impl BundlerPlugin for TestBundlerPlugin {
    fn bundle(&self, _bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn optimize(&self, _bundle_graph: &mut BundleGraph) -> Result<(), anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_dyn() {
    let _bundler: Box<dyn BundlerPlugin> = Box::new(TestBundlerPlugin {});
  }
}
