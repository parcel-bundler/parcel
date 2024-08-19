use std::path::PathBuf;
use std::sync::Arc;

use atlaspack_config::atlaspack_config_fixtures::default_config;
use atlaspack_core::{
  config_loader::ConfigLoader,
  plugin::{PluginContext, PluginLogger, PluginOptions},
  types::AtlaspackOptions,
};
use atlaspack_filesystem::{in_memory_file_system::InMemoryFileSystem, FileSystemRef};

use crate::{
  plugins::{config_plugins::ConfigPlugins, PluginsRef},
  request_tracker::RequestTracker,
};

pub(crate) fn make_test_plugin_context() -> PluginContext {
  let fs = Arc::new(InMemoryFileSystem::default());

  PluginContext {
    config: Arc::new(ConfigLoader {
      fs: fs.clone(),
      project_root: PathBuf::default(),
      search_path: PathBuf::default(),
    }),
    file_system: fs.clone(),
    options: Arc::new(PluginOptions::default()),
    logger: PluginLogger::default(),
  }
}

pub(crate) fn config_plugins(ctx: PluginContext) -> PluginsRef {
  let fixture = default_config(Arc::new(PathBuf::default()));

  Arc::new(ConfigPlugins::new(fixture.atlaspack_config, ctx))
}

pub struct RequestTrackerTestOptions {
  pub fs: FileSystemRef,
  pub plugins: Option<PluginsRef>,
  pub project_root: PathBuf,
  pub search_path: PathBuf,
  pub atlaspack_options: AtlaspackOptions,
}

impl Default for RequestTrackerTestOptions {
  fn default() -> Self {
    Self {
      fs: Arc::new(InMemoryFileSystem::default()),
      plugins: None,
      project_root: PathBuf::default(),
      search_path: PathBuf::default(),
      atlaspack_options: AtlaspackOptions::default(),
    }
  }
}

pub(crate) fn request_tracker(options: RequestTrackerTestOptions) -> RequestTracker {
  let RequestTrackerTestOptions {
    fs,
    plugins,
    project_root,
    search_path,
    atlaspack_options,
  } = options;

  let config_loader = Arc::new(ConfigLoader {
    fs: fs.clone(),
    project_root: project_root.clone(),
    search_path,
  });

  let plugins = plugins.unwrap_or_else(|| {
    config_plugins(PluginContext {
      config: Arc::clone(&config_loader),
      file_system: fs.clone(),
      options: Arc::new(PluginOptions {
        core_path: atlaspack_options.core_path.clone(),
        env: atlaspack_options.env.clone(),
        log_level: atlaspack_options.log_level.clone(),
        mode: atlaspack_options.mode.clone(),
        project_root: project_root.clone(),
      }),
      logger: PluginLogger::default(),
    })
  });

  RequestTracker::new(
    Arc::clone(&config_loader),
    fs,
    Arc::new(atlaspack_options),
    plugins,
    project_root,
  )
}
