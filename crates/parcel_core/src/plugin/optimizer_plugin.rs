use std::fmt::Debug;
use std::fs::File;

use super::PluginConfig;
use crate::bundle_graph::BundleGraph;
use crate::types::Bundle;
use crate::types::SourceMap;

pub struct OptimizeContext<'a> {
  pub bundle: &'a Bundle,
  pub bundle_graph: &'a BundleGraph,
  pub contents: &'a File, // TODO We may want this to be a String or File later
  pub map: Option<&'a SourceMap>,
  // TODO getSourceMapReference?
}

pub struct OptimizedBundle {
  pub contents: File,
  // TODO ast, map, type
}

/// Optimises a bundle
///
/// Optimizers are commonly used to implement minification, tree shaking, dead code elimination,
/// and other size reduction techniques that need a full bundle to be effective. However,
/// optimizers can also be used for any type of bundle transformation, such as prepending license
/// headers, converting inline bundles to base 64, etc.
///
/// Multiple optimizer plugins may run in series, and the result of each optimizer is passed to
/// the next.
///
pub trait OptimizerPlugin: Debug + Send + Sync {
  /// A hook designed to setup config needed for optimizing bundles
  ///
  /// This function will run once, shortly after the plugin is initialised.
  ///
  fn load_config(&mut self, config: &PluginConfig) -> Result<(), anyhow::Error>;

  /// Transforms the contents of a bundle and its source map
  fn optimize(
    &mut self,
    config: &PluginConfig,
    ctx: OptimizeContext,
  ) -> Result<OptimizedBundle, anyhow::Error>;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug)]
  struct TestOptimizerPlugin {}

  impl OptimizerPlugin for TestOptimizerPlugin {
    fn load_config(&mut self, _config: &PluginConfig) -> Result<(), anyhow::Error> {
      todo!()
    }

    fn optimize(
      &mut self,
      _config: &PluginConfig,
      _ctx: OptimizeContext,
    ) -> Result<OptimizedBundle, anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut optimizers = Vec::<Box<dyn OptimizerPlugin>>::new();

    optimizers.push(Box::new(TestOptimizerPlugin {}));

    assert_eq!(optimizers.len(), 1);
  }
}
