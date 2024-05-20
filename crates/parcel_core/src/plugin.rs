mod bundler;
pub use bundler::*;

mod compressor;
pub use compressor::*;

mod namer;
pub use namer::*;

mod optimizer;
pub use optimizer::*;

mod packager;
pub use packager::*;

mod reporter;
pub use reporter::*;

mod resolver;
pub use resolver::*;

mod runtime;
pub use runtime::*;

mod transformer;
pub use transformer::*;

mod validator;
pub use validator::*;

pub struct PluginContext {
  pub options: PluginOptions,
  pub logger: PluginLogger,
}

pub struct PluginLogger {}

pub struct PluginOptions {}
