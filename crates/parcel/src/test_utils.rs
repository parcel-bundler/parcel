use std::path::PathBuf;
use std::sync::Arc;

use parcel_config::parcel_config_fixtures::default_config;
use parcel_core::{
  cache::MockCache,
  plugin::{
    composite_reporter_plugin::CompositeReporterPlugin, PluginConfig, PluginContext, PluginLogger,
    PluginOptions,
  },
};
use parcel_filesystem::{in_memory_file_system::InMemoryFileSystem, MockFileSystem};

use crate::{plugins::Plugins, request_tracker::RequestTracker};

pub(crate) fn make_test_plugin_context() -> Arc<PluginContext> {
  PluginContext {
    config: PluginConfig::new(
      Arc::new(InMemoryFileSystem::default()),
      PathBuf::default(),
      PathBuf::default(),
    ),
    options: Arc::new(PluginOptions::default()),
    logger: PluginLogger::default(),
  }
  .into()
}

pub(crate) fn plugins(ctx: Arc<PluginContext>) -> Plugins {
  let fixture = default_config(Arc::new(PathBuf::default()));

  Plugins::new(fixture.parcel_config, ctx)
}

pub(crate) fn request_tracker() -> RequestTracker {
  RequestTracker::new(
    Arc::new(CompositeReporterPlugin::new(vec![])),
    Arc::new(MockCache::new()),
    Arc::new(MockFileSystem::new()),
    Arc::new(plugins(make_test_plugin_context())),
  )
}
