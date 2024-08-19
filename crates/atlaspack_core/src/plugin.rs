use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

mod bundler_plugin;
pub use bundler_plugin::*;

mod compressor_plugin;
pub use compressor_plugin::*;

mod namer_plugin;
pub use namer_plugin::*;

mod optimizer_plugin;
pub use optimizer_plugin::*;

mod packager_plugin;
pub use packager_plugin::*;

mod reporter_plugin;
use atlaspack_filesystem::FileSystemRef;
pub use reporter_plugin::*;

mod resolver_plugin;
pub use resolver_plugin::*;

mod runtime_plugin;
pub use runtime_plugin::*;

mod transformer_plugin;
pub use transformer_plugin::*;

mod validator_plugin;
pub use validator_plugin::*;

use crate::config_loader::{ConfigLoader, ConfigLoaderRef};
use crate::types::{BuildMode, LogLevel};

pub struct PluginContext {
  pub config: ConfigLoaderRef,
  pub file_system: FileSystemRef,
  pub logger: PluginLogger,
  pub options: Arc<PluginOptions>,
}

#[derive(Default)]
pub struct PluginLogger {}

#[derive(Debug, Default)]
pub struct PluginOptions {
  pub core_path: PathBuf,
  pub env: Option<HashMap<String, String>>,
  pub log_level: LogLevel,
  pub mode: BuildMode,
  pub project_root: PathBuf,
}
