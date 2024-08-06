use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;
use std::sync::Arc;

use parcel_config::map::NamedPattern;
use parcel_config::ParcelConfig;
use parcel_core::diagnostic_error;
use parcel_core::plugin::composite_reporter_plugin::CompositeReporterPlugin;
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
use parcel_plugin_rpc::RpcWorkerRef;
use parcel_plugin_transformer_js::ParcelJsTransformerPlugin;

use super::Plugins;
use super::TransformerPipeline;

/// Loads plugins based on the Parcel config
pub struct ConfigPlugins {
  /// The Parcel config that determines what plugins will be loaded
  config: ParcelConfig,

  /// Dependencies available to all plugin types
  ctx: PluginContext,

  /// A reporter that runs all reporter plugins
  reporter: Arc<dyn ReporterPlugin>,

  /// Connection to the RPC worker context
  rpc_worker: Option<RpcWorkerRef>,

  resolvers: Vec<Arc<dyn ResolverPlugin>>,
}

impl ConfigPlugins {
  pub fn new(
    config: ParcelConfig,
    ctx: PluginContext,
    rpc_worker: Option<RpcWorkerRef>,
  ) -> anyhow::Result<Self> {
    let mut reporters: Vec<Box<dyn ReporterPlugin>> = Vec::new();

    for reporter in config.reporters.iter() {
      reporters.push(Box::new(RpcReporterPlugin::new(&ctx, reporter)));
    }

    let reporter = Arc::new(CompositeReporterPlugin::new(reporters));

    // Load the resolver plugins
    let mut resolvers = vec![];
    if let Some(rpc_worker) = &rpc_worker {
      for resolver in config.resolvers.iter() {
        resolvers.push(
          Arc::new(RpcResolverPlugin::new(&*rpc_worker, resolver)?) as Arc<dyn ResolverPlugin>
        );
      }
    }

    Ok(ConfigPlugins {
      config,
      ctx,
      reporter,
      rpc_worker,
      resolvers,
    })
  }

  fn missing_plugin(&self, path: &Path, phase: &str) -> anyhow::Error {
    diagnostic_error!("No {phase} found for path {}", path.display())
  }

  fn missing_pipeline_plugin(&self, path: &Path, phase: &str, pipeline: &str) -> anyhow::Error {
    diagnostic_error!(
      "No {phase} found for path {} with pipeline {pipeline}",
      path.display(),
    )
  }
}

impl Plugins for ConfigPlugins {
  #[allow(unused)]
  fn bundler(&self) -> Result<Box<dyn BundlerPlugin>, anyhow::Error> {
    Ok(Box::new(RpcBundlerPlugin::new(
      &self.ctx,
      &self.config.bundler,
    )?))
  }

  #[allow(unused)]
  fn compressors(&self, path: &Path) -> Result<Vec<Box<dyn CompressorPlugin>>, anyhow::Error> {
    let mut compressors: Vec<Box<dyn CompressorPlugin>> = Vec::new();

    for compressor in self.config.compressors.get(path).iter() {
      compressors.push(Box::new(RpcCompressorPlugin::new(&self.ctx, compressor)));
    }

    if compressors.is_empty() {
      return Err(self.missing_plugin(path, "compressors"));
    }

    Ok(compressors)
  }

  fn named_pipelines(&self) -> Vec<String> {
    self.config.transformers.named_pipelines()
  }

  #[allow(unused)]
  fn namers(&self) -> Result<Vec<Box<dyn NamerPlugin>>, anyhow::Error> {
    let mut namers: Vec<Box<dyn NamerPlugin>> = Vec::new();

    for namer in self.config.namers.iter() {
      namers.push(Box::new(RpcNamerPlugin::new(&self.ctx, namer)?));
    }

    Ok(namers)
  }

  #[allow(unused)]
  fn optimizers(
    &self,
    path: &Path,
    pipeline: Option<String>,
  ) -> Result<Vec<Box<dyn OptimizerPlugin>>, anyhow::Error> {
    let mut optimizers: Vec<Box<dyn OptimizerPlugin>> = Vec::new();
    let named_pattern = pipeline.as_ref().map(|pipeline| NamedPattern {
      pipeline,
      use_fallback: true,
    });

    for optimizer in self.config.optimizers.get(path, named_pattern).iter() {
      optimizers.push(Box::new(RpcOptimizerPlugin::new(&self.ctx, optimizer)?));
    }

    Ok(optimizers)
  }

  #[allow(unused)]
  fn packager(&self, path: &Path) -> Result<Box<dyn PackagerPlugin>, anyhow::Error> {
    let packager = self.config.packagers.get(path);

    match packager {
      None => Err(self.missing_plugin(path, "packager")),
      Some(packager) => Ok(Box::new(RpcPackagerPlugin::new(&self.ctx, packager)?)),
    }
  }

  fn reporter(&self) -> Arc<dyn ReporterPlugin> {
    self.reporter.clone()
  }

  fn resolvers(&self) -> Result<Vec<Arc<dyn ResolverPlugin>>, anyhow::Error> {
    Ok(self.resolvers.clone())
  }

  #[allow(unused)]
  fn runtimes(&self) -> Result<Vec<Box<dyn RuntimePlugin>>, anyhow::Error> {
    let mut runtimes: Vec<Box<dyn RuntimePlugin>> = Vec::new();

    for runtime in self.config.runtimes.iter() {
      runtimes.push(Box::new(RpcRuntimePlugin::new(&self.ctx, runtime)?));
    }

    Ok(runtimes)
  }

  /// Resolve and load transformer plugins for a given path.
  fn transformers(
    &self,
    path: &Path,
    pipeline: Option<String>,
  ) -> Result<TransformerPipeline, anyhow::Error> {
    let mut transformers: Vec<Box<dyn TransformerPlugin>> = Vec::new();
    let named_pattern = pipeline.as_ref().map(|pipeline| NamedPattern {
      pipeline,
      use_fallback: false,
    });

    let mut hasher = parcel_core::hash::IdentifierHasher::default();

    for transformer in self.config.transformers.get(path, named_pattern).iter() {
      transformer.hash(&mut hasher);
      if transformer.package_name == "@parcel/transformer-babel"
        || transformer.package_name == "@parcel/transformer-react-refresh-wrap"
      {
        // Currently JS plugins don't work and it's easier to just skip these.
        // We also will probably remove babel from the defaults and support
        // react refresh in Rust before releasing native asset graph
        continue;
      }

      if transformer.package_name == "@parcel/transformer-js" {
        transformers.push(Box::new(ParcelJsTransformerPlugin::new()));
        continue;
      }

      transformers.push(Box::new(RpcTransformerPlugin::new(&self.ctx, transformer)?));
    }

    if transformers.is_empty() {
      return match pipeline {
        None => Err(self.missing_plugin(path, "transformers")),
        Some(pipeline) => Err(self.missing_pipeline_plugin(path, "transformers", &pipeline)),
      };
    }

    Ok(TransformerPipeline {
      transformers,
      hash: hasher.finish(),
    })
  }

  #[allow(unused)]
  fn validators(&self, _path: &Path) -> Result<Vec<Box<dyn ValidatorPlugin>>, anyhow::Error> {
    todo!()
  }
}

#[cfg(test)]
mod tests {
  use crate::test_utils::{config_plugins, make_test_plugin_context};

  use super::*;

  #[test]
  fn returns_bundler() {
    let bundler = config_plugins(make_test_plugin_context())
      .bundler()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", bundler), "RpcBundlerPlugin")
  }

  #[test]
  fn returns_compressors() {
    let compressors = config_plugins(make_test_plugin_context())
      .compressors(Path::new("a.js"))
      .expect("Not to panic");

    assert_eq!(format!("{:?}", compressors), "[RpcCompressorPlugin]")
  }

  #[test]
  fn returns_namers() {
    let namers = config_plugins(make_test_plugin_context())
      .namers()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", namers), "[RpcNamerPlugin]")
  }

  #[test]
  fn returns_optimizers() {
    let optimizers = config_plugins(make_test_plugin_context())
      .optimizers(Path::new("a.js"), None)
      .expect("Not to panic");

    assert_eq!(format!("{:?}", optimizers), "[RpcOptimizerPlugin]")
  }

  #[test]
  fn returns_packager() {
    let packager = config_plugins(make_test_plugin_context())
      .packager(Path::new("a.js"))
      .expect("Not to panic");

    assert_eq!(format!("{:?}", packager), "RpcPackagerPlugin")
  }

  #[test]
  fn returns_reporter() {
    let reporter = config_plugins(make_test_plugin_context()).reporter();

    assert_eq!(
      format!("{:?}", reporter),
      "CompositeReporterPlugin { reporters: [RpcReporterPlugin] }"
    )
  }

  #[test]
  fn returns_resolvers() {
    let resolvers = config_plugins(make_test_plugin_context())
      .resolvers()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", resolvers), "[ParcelResolver]")
  }

  #[test]
  fn returns_runtimes() {
    let runtimes = config_plugins(make_test_plugin_context())
      .runtimes()
      .expect("Not to panic");

    assert_eq!(format!("{:?}", runtimes), "[RpcRuntimePlugin]")
  }

  #[test]
  fn returns_transformers() {
    let transformers = config_plugins(make_test_plugin_context())
      .transformers(Path::new("a.ts"), None)
      .expect("Not to panic");

    assert_eq!(
      format!("{:?}", transformers),
      r"TransformerPipeline { transformers: [ParcelJsTransformerPlugin] }"
    )
  }
}
