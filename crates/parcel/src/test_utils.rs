use std::path::PathBuf;
use std::sync::Arc;

use parcel_config::parcel_config_fixtures::default_config;
use parcel_core::{
  config_loader::ConfigLoader,
  plugin::{PluginContext, PluginLogger, PluginOptions},
  types::ParcelOptions,
};
use parcel_filesystem::{in_memory_file_system::InMemoryFileSystem, FileSystemRef};

use crate::{
  plugins::{config_plugins::ConfigPlugins, PluginsRef},
  request_tracker::RequestTracker,
};

pub(crate) fn make_test_plugin_context() -> PluginContext {
  PluginContext {
    config: Arc::new(ConfigLoader {
      fs: Arc::new(InMemoryFileSystem::default()),
      project_root: PathBuf::default(),
      search_path: PathBuf::default(),
    }),
    options: Arc::new(PluginOptions::default()),
    logger: PluginLogger::default(),
  }
}

pub(crate) fn config_plugins(ctx: PluginContext) -> PluginsRef {
  let fixture = default_config(Arc::new(PathBuf::default()));

  Arc::new(ConfigPlugins::new(fixture.parcel_config, ctx))
}

pub struct RequestTrackerTestOptions {
  pub fs: FileSystemRef,
  pub plugins: Option<PluginsRef>,
  pub project_root: PathBuf,
  pub search_path: PathBuf,
  pub parcel_options: ParcelOptions,
}

impl Default for RequestTrackerTestOptions {
  fn default() -> Self {
    Self {
      fs: Arc::new(InMemoryFileSystem::default()),
      plugins: None,
      project_root: PathBuf::default(),
      search_path: PathBuf::default(),
      parcel_options: ParcelOptions::default(),
    }
  }
}

pub(crate) fn request_tracker(options: RequestTrackerTestOptions) -> RequestTracker {
  let RequestTrackerTestOptions {
    fs,
    plugins,
    project_root,
    search_path,
    parcel_options,
  } = options;

  let config_loader = Arc::new(ConfigLoader {
    fs: fs.clone(),
    project_root: project_root.clone(),
    search_path,
  });

  let plugins = plugins.unwrap_or_else(|| {
    config_plugins(PluginContext {
      config: Arc::clone(&config_loader),
      options: Arc::new(PluginOptions::default()),
      logger: PluginLogger::default(),
    })
  });

  RequestTracker::new(
    Arc::clone(&config_loader),
    fs,
    Arc::new(parcel_options),
    plugins,
    project_root,
  )
}
