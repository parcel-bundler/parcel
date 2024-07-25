use std::fmt::Debug;
use std::path::Path;
use std::sync::Arc;
use std::u64;

#[cfg(test)]
use mockall::automock;
use parcel_core::plugin::BundlerPlugin;
use parcel_core::plugin::CompressorPlugin;
use parcel_core::plugin::NamerPlugin;
use parcel_core::plugin::OptimizerPlugin;
use parcel_core::plugin::PackagerPlugin;
use parcel_core::plugin::ReporterPlugin;
use parcel_core::plugin::ResolverPlugin;
use parcel_core::plugin::RuntimePlugin;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::ValidatorPlugin;

pub type PluginsRef = Arc<dyn Plugins + Send + Sync>;

pub mod config_plugins;

#[cfg_attr(test, automock)]
pub trait Plugins {
  fn bundler(&self) -> Result<Box<dyn BundlerPlugin>, anyhow::Error>;
  fn compressors(&self, path: &Path) -> Result<Vec<Box<dyn CompressorPlugin>>, anyhow::Error>;
  fn named_pipelines(&self) -> Vec<String>;
  fn namers(&self) -> Result<Vec<Box<dyn NamerPlugin>>, anyhow::Error>;
  fn optimizers(
    &self,
    path: &Path,
    pipeline: Option<String>,
  ) -> Result<Vec<Box<dyn OptimizerPlugin>>, anyhow::Error>;
  fn packager(&self, path: &Path) -> Result<Box<dyn PackagerPlugin>, anyhow::Error>;
  fn reporter(&self) -> Arc<dyn ReporterPlugin>;
  fn resolvers(&self) -> Result<Vec<Box<dyn ResolverPlugin>>, anyhow::Error>;
  fn runtimes(&self) -> Result<Vec<Box<dyn RuntimePlugin>>, anyhow::Error>;
  fn transformers(
    &self,
    path: &Path,
    pipeline: Option<String>,
  ) -> Result<TransformerPipeline, anyhow::Error>;
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
