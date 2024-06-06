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

mod plugin_config;
pub use plugin_config::*;

mod reporter_plugin;
pub use reporter_plugin::*;

mod resolver_plugin;
pub use resolver_plugin::*;

mod runtime_plugin;
pub use runtime_plugin::*;

mod transformer_plugin;
pub use transformer_plugin::*;

mod validator_plugin;
pub use validator_plugin::*;

pub struct PluginContext {
  pub config: PluginConfig,
  pub options: PluginOptions,
  pub logger: PluginLogger,
}

#[derive(Default)]
pub struct PluginLogger {}

#[derive(Default)]
pub struct PluginOptions {
  pub mode: crate::types::BuildMode,
}
