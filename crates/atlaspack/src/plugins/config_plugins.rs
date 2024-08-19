use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;
use std::sync::Arc;

use atlaspack_config::map::NamedPattern;
use atlaspack_config::AtlaspackConfig;
use atlaspack_core::diagnostic_error;
use atlaspack_core::plugin::composite_reporter_plugin::CompositeReporterPlugin;
use atlaspack_core::plugin::BundlerPlugin;
use atlaspack_core::plugin::CompressorPlugin;
use atlaspack_core::plugin::NamerPlugin;
use atlaspack_core::plugin::OptimizerPlugin;
use atlaspack_core::plugin::PackagerPlugin;
use atlaspack_core::plugin::PluginContext;
use atlaspack_core::plugin::ReporterPlugin;
use atlaspack_core::plugin::ResolverPlugin;
use atlaspack_core::plugin::RuntimePlugin;
use atlaspack_core::plugin::TransformerPlugin;
use atlaspack_core::plugin::ValidatorPlugin;
use atlaspack_plugin_resolver::AtlaspackResolver;
use atlaspack_plugin_rpc::plugin::RpcBundlerPlugin;
use atlaspack_plugin_rpc::plugin::RpcCompressorPlugin;
use atlaspack_plugin_rpc::plugin::RpcNamerPlugin;
use atlaspack_plugin_rpc::plugin::RpcOptimizerPlugin;
use atlaspack_plugin_rpc::plugin::RpcPackagerPlugin;
use atlaspack_plugin_rpc::plugin::RpcReporterPlugin;
use atlaspack_plugin_rpc::plugin::RpcResolverPlugin;
use atlaspack_plugin_rpc::plugin::RpcRuntimePlugin;
use atlaspack_plugin_rpc::plugin::RpcTransformerPlugin;
use atlaspack_plugin_transformer_js::AtlaspackJsTransformerPlugin;

use super::Plugins;
use super::TransformerPipeline;

/// Loads plugins based on the Atlaspack config
pub struct ConfigPlugins {
  /// The Atlaspack config that determines what plugins will be loaded
  config: AtlaspackConfig,

  /// Dependencies available to all plugin types
  ctx: PluginContext,

  /// A reporter that runs all reporter plugins
  reporter: Arc<dyn ReporterPlugin>,
}

impl ConfigPlugins {
  pub fn new(config: AtlaspackConfig, ctx: PluginContext) -> Self {
    let mut reporters: Vec<Box<dyn ReporterPlugin>> = Vec::new();

    for reporter in config.reporters.iter() {
      reporters.push(Box::new(RpcReporterPlugin::new(&ctx, reporter)));
    }

    let reporter = Arc::new(CompositeReporterPlugin::new(reporters));

    ConfigPlugins {
      config,
      ctx,
      reporter,
    }
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

  fn resolvers(&self) -> Result<Vec<Box<dyn ResolverPlugin>>, anyhow::Error> {
    let mut resolvers: Vec<Box<dyn ResolverPlugin>> = Vec::new();

    for resolver in self.config.resolvers.iter() {
      if resolver.package_name == "@atlaspack/resolver-default" {
        resolvers.push(Box::new(AtlaspackResolver::new(&self.ctx)));
        continue;
      }

      resolvers.push(Box::new(RpcResolverPlugin::new(&self.ctx, resolver)?));
    }

    Ok(resolvers)
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

    let mut hasher = atlaspack_core::hash::IdentifierHasher::default();

    for transformer in self.config.transformers.get(path, named_pattern).iter() {
      transformer.hash(&mut hasher);
      if transformer.package_name == "@atlaspack/transformer-babel"
        || transformer.package_name == "@atlaspack/transformer-react-refresh-wrap"
      {
        // Currently JS plugins don't work and it's easier to just skip these.
        // We also will probably remove babel from the defaults and support
        // react refresh in Rust before releasing native asset graph
        continue;
      }

      if transformer.package_name == "@atlaspack/transformer-js" {
        transformers.push(Box::new(AtlaspackJsTransformerPlugin::new(&self.ctx)?));
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

    assert_eq!(format!("{:?}", resolvers), "[AtlaspackResolver]")
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
    let pipeline = config_plugins(make_test_plugin_context())
      .transformers(Path::new("a.ts"), None)
      .expect("Not to panic");

    assert_eq!(
      format!("{:?}", pipeline),
      format!(
        "{:?}",
        TransformerPipeline {
          transformers: vec![Box::new(
            AtlaspackJsTransformerPlugin::new(&make_test_plugin_context()).unwrap()
          )],
          hash: 1
        }
      )
    );
  }
}
