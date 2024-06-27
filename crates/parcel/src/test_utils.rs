use std::path::PathBuf;
use std::sync::Arc;

use parcel_config::parcel_config_fixtures::default_config;
use parcel_core::{
  cache::MockCache,
  config_loader::ConfigLoader,
  plugin::{PluginContext, PluginLogger, PluginOptions},
  types::ParcelOptions,
};
use parcel_filesystem::{in_memory_file_system::InMemoryFileSystem, FileSystemRef, MockFileSystem};

use crate::{plugins::Plugins, request_tracker::RequestTracker};

pub(crate) fn make_test_plugin_context() -> Arc<PluginContext> {
  PluginContext {
    config: Arc::new(ConfigLoader {
      fs: Arc::new(InMemoryFileSystem::default()),
      project_root: PathBuf::default(),
      search_path: PathBuf::default(),
    }),
    options: Arc::new(PluginOptions::default()),
    logger: PluginLogger::default(),
  }
  .into()
}

pub(crate) fn plugins(ctx: Arc<PluginContext>) -> Plugins {
  let fixture = default_config(Arc::new(PathBuf::default()));

  Plugins::new(fixture.parcel_config, ctx)
}

pub struct RequestTrackerTestOptions {
  pub fs: FileSystemRef,
  pub project_root: PathBuf,
  pub search_path: PathBuf,
}
impl Default for RequestTrackerTestOptions {
  fn default() -> Self {
    Self {
      fs: Arc::new(InMemoryFileSystem::default()),
      search_path: PathBuf::default(),
      project_root: PathBuf::default(),
    }
  }
}
pub(crate) fn request_tracker(options: RequestTrackerTestOptions) -> RequestTracker {
  let RequestTrackerTestOptions {
    fs,
    search_path,
    project_root,
  } = options;
  let parcel_options = ParcelOptions {
    project_root: project_root.clone(),
    ..Default::default()
  };
  let config_loader = Arc::new(ConfigLoader {
    fs: fs.clone(),
    project_root,
    search_path,
  });
  RequestTracker::new(
    vec![],
    Arc::new(MockCache::new()),
    Arc::new(MockFileSystem::new()),
    Arc::new(plugins(Arc::new(PluginContext {
      config: config_loader.clone(),
      options: Arc::new(PluginOptions::default()),
      logger: PluginLogger::default(),
    }))),
    config_loader,
    parcel_options,
  )
}
