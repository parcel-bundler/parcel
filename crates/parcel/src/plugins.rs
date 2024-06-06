use std::path::Path;

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

use crate::napi::NapiBundlerPlugin;
use crate::napi::NapiCompressorPlugin;
use crate::napi::NapiNamerPlugin;
use crate::napi::NapiOptimizerPlugin;
use crate::napi::NapiPackagerPlugin;
use crate::napi::NapiReporterPlugin;
use crate::napi::NapiResolverPlugin;
use crate::napi::NapiRuntimePlugin;
use crate::napi::NapiTransformerPlugin;

// TODO Implement specifics of injecting env for napi plugins

/// Loads plugins based on the Parcel config
pub struct Plugins<'a> {
  /// The Parcel config that determines what plugins will be loaded
  config: ParcelConfig,

  /// Dependencies available to all plugin types
  ctx: &'a PluginContext,
}

impl<'a> Plugins<'a> {
  pub fn new(config: ParcelConfig, ctx: &'a PluginContext) -> Self {
    Plugins { config, ctx }
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
    Ok(Box::new(NapiBundlerPlugin::new(
      self.ctx,
      &self.config.bundler,
    )?))
  }

  pub fn compressors(&self, path: &Path) -> Result<Vec<Box<dyn CompressorPlugin>>, anyhow::Error> {
    let mut compressors: Vec<Box<dyn CompressorPlugin>> = Vec::new();

    for compressor in self.config.compressors.get(path).iter() {
      compressors.push(Box::new(NapiCompressorPlugin::new(self.ctx, compressor)));
    }

    if compressors.is_empty() {
      return Err(self.missing_plugin(path, "compressors"));
    }

    Ok(compressors)
  }

  pub fn namers(&self) -> Result<Vec<Box<dyn NamerPlugin>>, anyhow::Error> {
    let mut namers: Vec<Box<dyn NamerPlugin>> = Vec::new();

    for namer in self.config.namers.iter() {
      namers.push(Box::new(NapiNamerPlugin::new(self.ctx, namer)?));
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
      optimizers.push(Box::new(NapiOptimizerPlugin::new(self.ctx, optimizer)?));
    }

    Ok(optimizers)
  }

  pub fn packager(&self, path: &Path) -> Result<Box<dyn PackagerPlugin>, anyhow::Error> {
    let packager = self.config.packagers.get(path);

    match packager {
      None => Err(self.missing_plugin(path, "packager")),
      Some(packager) => Ok(Box::new(NapiPackagerPlugin::new(self.ctx, packager)?)),
    }
  }

  pub fn reporters(&self) -> Vec<Box<dyn ReporterPlugin>> {
    let mut reporters: Vec<Box<dyn ReporterPlugin>> = Vec::new();

    for reporter in self.config.reporters.iter() {
      reporters.push(Box::new(NapiReporterPlugin::new(self.ctx, reporter)));
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

      resolvers.push(Box::new(NapiResolverPlugin::new(self.ctx, resolver)?));
    }

    Ok(resolvers)
  }

  pub fn runtimes(&self) -> Result<Vec<Box<dyn RuntimePlugin>>, anyhow::Error> {
    let mut runtimes: Vec<Box<dyn RuntimePlugin>> = Vec::new();

    for runtime in self.config.runtimes.iter() {
      runtimes.push(Box::new(NapiRuntimePlugin::new(self.ctx, runtime)?));
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

      transformers.push(Box::new(NapiTransformerPlugin::new(self.ctx, transformer)?));
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

    Plugins::new(fixture.parcel_config, ctx)
  }

  #[test]
  fn returns_bundler() {
    let bundler = plugins(&ctx()).bundler();

    assert_eq!(
      format!("{:?}", bundler),
      "Ok(NapiBundlerPlugin { name: \"@parcel/bundler-default\" })"
    )
  }

  #[test]
  fn returns_compressors() {
    let compressors = plugins(&ctx()).compressors(Path::new("a.js"));

    assert_eq!(
      format!("{:?}", compressors),
      "Ok([NapiCompressorPlugin { name: \"@parcel/compressor-raw\" }])"
    )
  }

  #[test]
  fn returns_namers() {
    let namers = plugins(&ctx()).namers();

    assert_eq!(
      format!("{:?}", namers),
      "Ok([NapiNamerPlugin { name: \"@parcel/namer-default\" }])"
    )
  }

  #[test]
  fn returns_optimizers() {
    let optimizers = plugins(&ctx()).optimizers(Path::new("a.js"), None);

    assert_eq!(
      format!("{:?}", optimizers),
      "Ok([NapiOptimizerPlugin { name: \"@parcel/optimizer-swc\" }])"
    )
  }

  #[test]
  fn returns_packager() {
    let packager = plugins(&ctx()).packager(Path::new("a.js"));

    assert_eq!(
      format!("{:?}", packager),
      "Ok(NapiPackagerPlugin { name: \"@parcel/packager-js\" })"
    )
  }

  #[test]
  fn returns_reporters() {
    let resolvers = plugins(&ctx()).reporters();

    assert_eq!(
      format!("{:?}", resolvers),
      "[NapiReporterPlugin { name: \"@parcel/reporter-dev-server\" }]"
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
      "Ok([NapiRuntimePlugin { name: \"@parcel/runtime-js\" }])"
    )
  }

  #[test]
  fn returns_transformers() {
    let transformers = plugins(&ctx()).transformers(Path::new("a.ts"), None);

    assert_eq!(
      format!("{:?}", transformers),
      "Ok([NapiTransformerPlugin { name: \"@parcel/transformer-js\" }])"
    )
  }
}
