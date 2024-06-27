use std::fmt::Debug;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;
use std::sync::Arc;
use std::u64;

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
use parcel_plugin_rpc::plugin::RpcBundlerPlugin;
use parcel_plugin_rpc::plugin::RpcCompressorPlugin;
use parcel_plugin_rpc::plugin::RpcNamerPlugin;
use parcel_plugin_rpc::plugin::RpcOptimizerPlugin;
use parcel_plugin_rpc::plugin::RpcPackagerPlugin;
use parcel_plugin_rpc::plugin::RpcReporterPlugin;
use parcel_plugin_rpc::plugin::RpcResolverPlugin;
use parcel_plugin_rpc::plugin::RpcRuntimePlugin;
use parcel_plugin_rpc::plugin::RpcTransformerPlugin;
use parcel_plugin_transformer_js::ParcelJsTransformerPlugin;

// TODO Implement specifics of injecting env for napi plugins

pub type PluginsRef = Arc<Plugins>;

/// Loads plugins based on the Parcel config
pub struct Plugins {
  /// The Parcel config that determines what plugins will be loaded
  config: ParcelConfig,

  /// Dependencies available to all plugin types
  ctx: Arc<PluginContext>,
}

impl Plugins {
  #[allow(unused)]
  pub fn new(config: ParcelConfig, ctx: Arc<PluginContext>) -> Self {
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

  #[allow(unused)]
  pub fn bundler(&self) -> Result<Box<dyn BundlerPlugin>, anyhow::Error> {
    Ok(Box::new(RpcBundlerPlugin::new(
      &self.ctx,
      &self.config.bundler,
    )?))
  }

  #[allow(unused)]
  pub fn compressors(&self, path: &Path) -> Result<Vec<Box<dyn CompressorPlugin>>, anyhow::Error> {
    let mut compressors: Vec<Box<dyn CompressorPlugin>> = Vec::new();

    for compressor in self.config.compressors.get(path).iter() {
      compressors.push(Box::new(RpcCompressorPlugin::new(&self.ctx, compressor)));
    }

    if compressors.is_empty() {
      return Err(self.missing_plugin(path, "compressors"));
    }

    Ok(compressors)
  }

  #[allow(unused)]
  pub fn namers(&self) -> Result<Vec<Box<dyn NamerPlugin>>, anyhow::Error> {
    let mut namers: Vec<Box<dyn NamerPlugin>> = Vec::new();

    for namer in self.config.namers.iter() {
      namers.push(Box::new(RpcNamerPlugin::new(&self.ctx, namer)?));
    }

    Ok(namers)
  }

  #[allow(unused)]
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
      optimizers.push(Box::new(RpcOptimizerPlugin::new(&self.ctx, optimizer)?));
    }

    Ok(optimizers)
  }

  #[allow(unused)]
  pub fn packager(&self, path: &Path) -> Result<Box<dyn PackagerPlugin>, anyhow::Error> {
    let packager = self.config.packagers.get(path);

    match packager {
      None => Err(self.missing_plugin(path, "packager")),
      Some(packager) => Ok(Box::new(RpcPackagerPlugin::new(&self.ctx, packager)?)),
    }
  }

  #[allow(unused)]
  pub fn reporters(&self) -> Vec<Box<dyn ReporterPlugin>> {
    let mut reporters: Vec<Box<dyn ReporterPlugin>> = Vec::new();

    for reporter in self.config.reporters.iter() {
      reporters.push(Box::new(RpcReporterPlugin::new(&self.ctx, reporter)));
    }

    reporters
  }

  #[allow(unused)]
  pub fn resolvers(&self) -> Result<Vec<Box<dyn ResolverPlugin>>, anyhow::Error> {
    let mut resolvers: Vec<Box<dyn ResolverPlugin>> = Vec::new();

    for resolver in self.config.resolvers.iter() {
      if resolver.package_name == "@parcel/resolver-default" {
        resolvers.push(Box::new(ParcelResolver::new(&self.ctx)));
        continue;
      }

      resolvers.push(Box::new(RpcResolverPlugin::new(&self.ctx, resolver)?));
    }

    Ok(resolvers)
  }

  #[allow(unused)]
  pub fn runtimes(&self) -> Result<Vec<Box<dyn RuntimePlugin>>, anyhow::Error> {
    let mut runtimes: Vec<Box<dyn RuntimePlugin>> = Vec::new();

    for runtime in self.config.runtimes.iter() {
      runtimes.push(Box::new(RpcRuntimePlugin::new(&self.ctx, runtime)?));
    }

    Ok(runtimes)
  }

  /// Resolve and load transformer plugins for a given path.
  #[allow(unused)]
  pub fn transformers(
    &self,
    path: &Path,
    pipeline: Option<&str>,
  ) -> Result<TransformerPipeline, anyhow::Error> {
    let mut transformers: Vec<Box<dyn TransformerPlugin>> = Vec::new();
    let named_pattern = pipeline.map(|pipeline| NamedPattern {
      pipeline,
      use_fallback: false,
    });

    let mut hasher = parcel_core::hash::IdentifierHasher::default();

    for transformer in self.config.transformers.get(path, named_pattern).iter() {
      transformer.hash(&mut hasher);
      if transformer.package_name == "@parcel/transformer-swc" {
        transformers.push(Box::new(ParcelJsTransformerPlugin::new()));
        continue;
      }

      transformers.push(Box::new(RpcTransformerPlugin::new(&self.ctx, transformer)?));
    }

    if transformers.is_empty() {
      return match pipeline {
        None => Err(self.missing_plugin(path, "transformers")),
        Some(pipeline) => Err(self.missing_pipeline_plugin(path, "transformers", pipeline)),
      };
    }

    Ok(TransformerPipeline {
      transformers,
      hash: hasher.finish(),
    })
  }

  #[allow(unused)]
  pub fn validators(&self, _path: &Path) -> Result<Vec<Box<dyn ValidatorPlugin>>, anyhow::Error> {
    todo!()
  }
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

#[cfg(test)]
mod tests {
  use crate::test_utils::{make_test_plugin_context, plugins};

  use super::*;

  #[test]
  fn returns_bundler() {
    let bundler = plugins(make_test_plugin_context())
      .bundler()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", bundler), "RpcBundlerPlugin")
  }

  #[test]
  fn returns_compressors() {
    let compressors = plugins(make_test_plugin_context())
      .compressors(Path::new("a.js"))
      .expect("Not to panic");

    assert_eq!(format!("{:?}", compressors), "[RpcCompressorPlugin]")
  }

  #[test]
  fn returns_namers() {
    let namers = plugins(make_test_plugin_context())
      .namers()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", namers), "[RpcNamerPlugin]")
  }

  #[test]
  fn returns_optimizers() {
    let optimizers = plugins(make_test_plugin_context())
      .optimizers(Path::new("a.js"), None)
      .expect("Not to panic");

    assert_eq!(format!("{:?}", optimizers), "[RpcOptimizerPlugin]")
  }

  #[test]
  fn returns_packager() {
    let packager = plugins(make_test_plugin_context())
      .packager(Path::new("a.js"))
      .expect("Not to panic");

    assert_eq!(format!("{:?}", packager), "RpcPackagerPlugin")
  }

  #[test]
  fn returns_reporters() {
    let reporters = plugins(make_test_plugin_context()).reporters();

    assert_eq!(format!("{:?}", reporters), "[RpcReporterPlugin]")
  }

  #[test]
  fn returns_resolvers() {
    let resolvers = plugins(make_test_plugin_context())
      .resolvers()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", resolvers), "[ParcelResolver]")
  }

  #[test]
  fn returns_runtimes() {
    let runtimes = plugins(make_test_plugin_context())
      .runtimes()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", runtimes), "[RpcRuntimePlugin]")
  }

  #[test]
  fn returns_transformers() {
    let transformers = plugins(make_test_plugin_context())
      .transformers(Path::new("a.ts"), None)
      .expect("Not to panic");

    assert_eq!(
      format!("{:?}", transformers),
      r"TransformerPipeline { transformers: [RpcTransformerPlugin] }"
    )
  }
}
