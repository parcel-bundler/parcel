use std::fmt::Debug;
use std::path::Path;
use std::sync::Arc;
use std::u64;

#[cfg(test)]
use mockall::automock;
use atlaspack_core::plugin::BundlerPlugin;
use atlaspack_core::plugin::CompressorPlugin;
use atlaspack_core::plugin::NamerPlugin;
use atlaspack_core::plugin::OptimizerPlugin;
use atlaspack_core::plugin::PackagerPlugin;
use atlaspack_core::plugin::ReporterPlugin;
use atlaspack_core::plugin::ResolverPlugin;
use atlaspack_core::plugin::RuntimePlugin;
use atlaspack_core::plugin::TransformerPlugin;
use atlaspack_core::plugin::ValidatorPlugin;

pub type PluginsRef = Arc<dyn Plugins + Send + Sync>;

pub mod config_plugins;

#[cfg_attr(test, automock)]
pub trait Plugins {
  #[allow(unused)]
  fn bundler(&self) -> Result<Box<dyn BundlerPlugin>, anyhow::Error>;
  #[allow(unused)]
  fn compressors(&self, path: &Path) -> Result<Vec<Box<dyn CompressorPlugin>>, anyhow::Error>;
  fn named_pipelines(&self) -> Vec<String>;
  #[allow(unused)]
  fn namers(&self) -> Result<Vec<Box<dyn NamerPlugin>>, anyhow::Error>;
  #[allow(unused)]
  fn optimizers(
    &self,
    path: &Path,
    pipeline: Option<String>,
  ) -> Result<Vec<Box<dyn OptimizerPlugin>>, anyhow::Error>;
  #[allow(unused)]
  fn packager(&self, path: &Path) -> Result<Box<dyn PackagerPlugin>, anyhow::Error>;
  fn reporter(&self) -> Arc<dyn ReporterPlugin>;
  fn resolvers(&self) -> Result<Vec<Box<dyn ResolverPlugin>>, anyhow::Error>;
  #[allow(unused)]
  fn runtimes(&self) -> Result<Vec<Box<dyn RuntimePlugin>>, anyhow::Error>;
  fn transformers(
    &self,
    path: &Path,
    pipeline: Option<String>,
  ) -> Result<TransformerPipeline, anyhow::Error>;
  #[allow(unused)]
  fn validators(&self, _path: &Path) -> Result<Vec<Box<dyn ValidatorPlugin>>, anyhow::Error>;
}

pub struct TransformerPipeline {
  pub transformers: Vec<Box<dyn TransformerPlugin>>,
  hash: u64,
}

impl TransformerPipeline {
  pub fn hash(&self) -> u64 {
    self.hash
  }
}

impl Debug for TransformerPipeline {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("TransformerPipeline")
      .field("transformers", &self.transformers)
      .finish()
  }
}
