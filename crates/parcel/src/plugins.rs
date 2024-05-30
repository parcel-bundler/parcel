use std::path::Path;
use std::sync::Arc;

use anyhow::anyhow;
use parcel_config::map::NamedPattern;
use parcel_config::ParcelConfig;
use parcel_core::plugin::BundlerPlugin;
use parcel_core::plugin::CompressorPlugin;
use parcel_core::plugin::NamerPlugin;
use parcel_core::plugin::OptimizerPlugin;
use parcel_core::plugin::PackagerPlugin;
use parcel_core::plugin::PluginContext;
use parcel_core::plugin::ReporterPlugin;
use parcel_core::plugin::ResolverPlugin;
use parcel_core::plugin::RuntimePlugin;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::ValidatorPlugin;
use parcel_plugin_resolver::ParcelResolver;
use parcel_plugin_transformer_js::ParcelTransformerJs;

use crate::adapter::Adapter;
use crate::adapter::BundlerAdapter;
use crate::adapter::CompressorAdapter;
use crate::adapter::NamerAdapter;
use crate::adapter::OptimizerAdapter;
use crate::adapter::PackagerAdapter;
use crate::adapter::ReporterAdapter;
use crate::adapter::ResolverAdapter;
use crate::adapter::RuntimeAdapter;
use crate::adapter::TransformerAdapter;

/// Loads plugins based on the Parcel config
pub struct Plugins<'a> {
  /// An adapter that enables the creation of JavaScript plugins via napi
  adapter: Arc<dyn Adapter>,

  /// The Parcel config that determines what plugins will be loaded
  config: ParcelConfig,

  /// Dependencies available to all plugin types
  ctx: &'a PluginContext,
}

impl<'a> Plugins<'a> {
  pub fn new(adapter: Arc<dyn Adapter>, config: ParcelConfig, ctx: &'a PluginContext) -> Self {
    Plugins {
      adapter,
      config,
      ctx,
    }
  }

  fn missing_plugin(&self, path: &Path, phase: &str) -> anyhow::Error {
    anyhow!("No {} found for path {}", phase, path.display())
  }

  fn missing_pipeline_plugin(&self, path: &Path, phase: &str, pipeline: &str) -> anyhow::Error {
    anyhow!(
      "No {} found for path {} with pipeline {}",
      phase,
      path.display(),
      pipeline
    )
  }

  pub fn bundler(&self) -> Result<Box<dyn BundlerPlugin>, anyhow::Error> {
    Ok(Box::new(BundlerAdapter::new(
      Arc::clone(&self.adapter),
      self.ctx,
      &self.config.bundler,
    )?))
  }

  pub fn compressors(&self, path: &Path) -> Result<Vec<Box<dyn CompressorPlugin>>, anyhow::Error> {
    let mut compressors: Vec<Box<dyn CompressorPlugin>> = Vec::new();

    for compressor in self.config.compressors.get(path).iter() {
      compressors.push(Box::new(CompressorAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        compressor,
      )));
    }

    if compressors.is_empty() {
      return Err(self.missing_plugin(path, "compressors"));
    }

    Ok(compressors)
  }

  pub fn namers(&self) -> Result<Vec<Box<dyn NamerPlugin>>, anyhow::Error> {
    let mut namers: Vec<Box<dyn NamerPlugin>> = Vec::new();

    for namer in self.config.namers.iter() {
      namers.push(Box::new(NamerAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        namer,
      )?));
    }

    Ok(namers)
  }

  pub fn optimizers(
    &self,
    path: &Path,
    pipeline: Option<&str>,
  ) -> Result<Vec<Box<dyn OptimizerPlugin>>, anyhow::Error> {
    let mut optimizers: Vec<Box<dyn OptimizerPlugin>> = Vec::new();
    let named_pattern = pipeline.map(|pipeline| NamedPattern {
      pipeline: pipeline.as_ref(),
      use_fallback: true,
    });

    for optimizer in self.config.optimizers.get(path, named_pattern).iter() {
      optimizers.push(Box::new(OptimizerAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        optimizer,
      )?));
    }

    Ok(optimizers)
  }

  pub fn packager(&self, path: &Path) -> Result<Box<dyn PackagerPlugin>, anyhow::Error> {
    let packager = self.config.packagers.get(path);

    match packager {
      None => Err(self.missing_plugin(path, "packager")),
      Some(packager) => Ok(Box::new(PackagerAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        packager,
      )?)),
    }
  }

  pub fn reporters(&self) -> Vec<Box<dyn ReporterPlugin>> {
    let mut reporters: Vec<Box<dyn ReporterPlugin>> = Vec::new();

    for reporter in self.config.reporters.iter() {
      reporters.push(Box::new(ReporterAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        reporter,
      )));
    }

    reporters
  }

  pub fn resolvers(&self) -> Result<Vec<Box<dyn ResolverPlugin>>, anyhow::Error> {
    let mut resolvers: Vec<Box<dyn ResolverPlugin>> = Vec::new();

    for resolver in self.config.resolvers.iter() {
      if resolver.package_name == "@parcel/resolver-default" {
        resolvers.push(Box::new(ParcelResolver::new(&self.ctx)));
        continue;
      }

      resolvers.push(Box::new(ResolverAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        resolver,
      )?));
    }

    Ok(resolvers)
  }

  pub fn runtimes(&self) -> Result<Vec<Box<dyn RuntimePlugin>>, anyhow::Error> {
    let mut runtimes: Vec<Box<dyn RuntimePlugin>> = Vec::new();

    for runtime in self.config.runtimes.iter() {
      runtimes.push(Box::new(RuntimeAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        runtime,
      )?));
    }

    Ok(runtimes)
  }

  pub fn transformers(
    &self,
    path: &Path,
    pipeline: Option<&str>,
  ) -> Result<Vec<Box<dyn TransformerPlugin>>, anyhow::Error> {
    let mut transformers: Vec<Box<dyn TransformerPlugin>> = Vec::new();
    let named_pattern = pipeline.map(|pipeline| NamedPattern {
      pipeline,
      use_fallback: false,
    });

    for transformer in self.config.transformers.get(path, named_pattern).iter() {
      if transformer.package_name == "@parcel/transformer-swc" {
        transformers.push(Box::new(ParcelTransformerJs::new(self.ctx)));
        continue;
      }

      transformers.push(Box::new(TransformerAdapter::new(
        Arc::clone(&self.adapter),
        self.ctx,
        transformer,
      )?));
    }

    if transformers.is_empty() {
      return match pipeline {
        None => Err(self.missing_plugin(path, "transformers")),
        Some(pipeline) => Err(self.missing_pipeline_plugin(path, "transformers", pipeline)),
      };
    }

    Ok(transformers)
  }

  pub fn validators(&self, _path: &Path) -> Result<Vec<Box<dyn ValidatorPlugin>>, anyhow::Error> {
    todo!()
  }
}

#[cfg(test)]
mod tests {
  use std::path::PathBuf;
  use std::rc::Rc;

  use parcel_config::parcel_config_fixtures::default_config;
  use parcel_core::plugin::PluginConfig;
  use parcel_core::plugin::PluginLogger;
  use parcel_core::plugin::PluginOptions;
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  // TODO Replace with actual impl later
  struct NapiAdapter {}

  impl Adapter for NapiAdapter {}

  fn ctx() -> PluginContext {
    PluginContext {
      config: PluginConfig::new(
        Rc::new(InMemoryFileSystem::default()),
        PathBuf::default(),
        PathBuf::default(),
      ),
      options: PluginOptions::default(),
      logger: PluginLogger::default(),
    }
  }

  fn plugins<'a>(ctx: &'a PluginContext) -> Plugins<'a> {
    let fixture = default_config(Rc::new(PathBuf::default()));

    Plugins::new(Arc::new(NapiAdapter {}), fixture.parcel_config, ctx)
  }

  #[test]
  fn returns_bundler() {
    let bundler = plugins(&ctx()).bundler();

    assert_eq!(
      format!("{:?}", bundler),
      "Ok(BundlerAdapter { name: \"@parcel/bundler-default\" })"
    )
  }

  #[test]
  fn returns_compressors() {
    let compressors = plugins(&ctx()).compressors(Path::new("a.js"));

    assert_eq!(
      format!("{:?}", compressors),
      "Ok([CompressorAdapter { name: \"@parcel/compressor-raw\" }])"
    )
  }

  #[test]
  fn returns_namers() {
    let namers = plugins(&ctx()).namers();

    assert_eq!(
      format!("{:?}", namers),
      "Ok([NamerAdapter { name: \"@parcel/namer-default\" }])"
    )
  }

  #[test]
  fn returns_optimizers() {
    let optimizers = plugins(&ctx()).optimizers(Path::new("a.js"), None);

    assert_eq!(
      format!("{:?}", optimizers),
      "Ok([OptimizerAdapter { name: \"@parcel/optimizer-swc\" }])"
    )
  }

  #[test]
  fn returns_packager() {
    let packager = plugins(&ctx()).packager(Path::new("a.js"));

    assert_eq!(
      format!("{:?}", packager),
      "Ok(PackagerAdapter { name: \"@parcel/packager-js\" })"
    )
  }

  #[test]
  fn returns_reporters() {
    let resolvers = plugins(&ctx()).reporters();

    assert_eq!(
      format!("{:?}", resolvers),
      "[ReporterAdapter { name: \"@parcel/reporter-dev-server\" }]"
    )
  }

  #[test]
  fn returns_resolvers() {
    let resolvers = plugins(&ctx()).resolvers();

    assert_eq!(format!("{:?}", resolvers), "Ok([ParcelResolver])")
  }

  #[test]
  fn returns_runtimes() {
    let runtimes = plugins(&ctx()).runtimes();

    assert_eq!(
      format!("{:?}", runtimes),
      "Ok([RuntimeAdapter { name: \"@parcel/runtime-js\" }])"
    )
  }

  #[test]
  fn returns_transformers() {
    let transformers = plugins(&ctx()).transformers(Path::new("a.ts"), None);

    assert_eq!(
      format!("{:?}", transformers),
      "Ok([TransformerAdapter { name: \"@parcel/transformer-js\" }])"
    )
  }
}
