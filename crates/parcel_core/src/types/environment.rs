use std::collections::HashMap;
use std::hash::Hash;
use std::hash::Hasher;
use std::num::NonZeroU32;

use serde::Deserialize;
use serde::Serialize;
use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

use self::engines::Engines;
use super::source::SourceLocation;

pub mod browsers;
pub mod engines;
mod output_format;
pub mod version;

pub use output_format::OutputFormat;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct EnvironmentId(pub NonZeroU32);

/// The environment the built code will run in
///
/// This influences how Parcel compiles your code, including what syntax to transpile.
///
#[derive(
  Clone,
  Debug,
  Default,
  Deserialize,
  Eq,
  Serialize,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
  bincode::Encode,
  bincode::Decode,
)]
#[serde(rename_all = "camelCase")]
#[archive(check_bytes)]
pub struct Environment {
  /// The environment the output should run in
  pub context: EnvironmentContext,

  /// The engines supported by the environment
  pub engines: Engines,

  /// Describes which node_modules should be included in the output
  pub include_node_modules: IncludeNodeModules,

  /// Whether this is a library build
  ///
  /// Treats the target as a library that would be published to npm and consumed by another tool,
  /// rather than used directly in a browser or other target environment.
  ///
  /// Library targets must enable scope hoisting, and use a non-global output format.
  ///
  pub is_library: bool,

  pub loc: Option<SourceLocation>,

  /// Determines what type of module to output
  pub output_format: OutputFormat,

  /// Determines whether scope hoisting should be enabled
  ///
  /// By default, scope hoisting is enabled for production builds.
  ///
  pub should_scope_hoist: bool,

  /// Determines whether the output should be optimised
  ///
  /// The exact behavior of this flag is determined by plugins. By default, optimization is
  /// enabled during production builds for application targets.
  ///
  pub should_optimize: bool,

  /// Configures source maps, which are enabled by default
  pub source_map: Option<TargetSourceMapOptions>,

  pub source_type: SourceType,
}

impl Hash for Environment {
  fn hash<H: Hasher>(&self, state: &mut H) {
    // Hashing intentionally does not include loc
    self.context.hash(state);
    self.engines.hash(state);
    self.include_node_modules.hash(state);
    self.is_library.hash(state);
    self.output_format.hash(state);
    self.should_scope_hoist.hash(state);
    self.should_optimize.hash(state);
    self.source_map.hash(state);
    self.source_type.hash(state);
  }
}

impl PartialEq for Environment {
  fn eq(&self, other: &Self) -> bool {
    // Equality intentionally does not include loc
    self.context == other.context
      && self.engines == other.engines
      && self.include_node_modules == other.include_node_modules
      && self.is_library == other.is_library
      && self.output_format == other.output_format
      && self.should_scope_hoist == other.should_scope_hoist
      && self.should_optimize == other.should_optimize
      && self.source_map == other.source_map
      && self.source_type == other.source_type
  }
}

/// The environment the output should run in
///
/// This informs Parcel what environment-specific APIs are available.
///
#[derive(
  Clone,
  Copy,
  Debug,
  Default,
  Deserialize,
  Eq,
  Hash,
  PartialEq,
  Serialize,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
  bincode::Encode,
  bincode::Decode,
)]
#[serde(rename_all = "kebab-case")]
#[archive(check_bytes)]
pub enum EnvironmentContext {
  #[default]
  Browser,
  ElectronMain,
  ElectronRenderer,
  Node,
  ServiceWorker,
  WebWorker,
  Worklet,
}

impl EnvironmentContext {
  pub fn is_node(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, Node | ElectronMain | ElectronRenderer)
  }

  pub fn is_browser(&self) -> bool {
    use EnvironmentContext::*;
    matches!(
      self,
      Browser | WebWorker | ServiceWorker | Worklet | ElectronRenderer
    )
  }

  pub fn is_worker(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, WebWorker | ServiceWorker)
  }

  pub fn is_electron(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, ElectronMain | ElectronRenderer)
  }
}

#[derive(
  Clone,
  Debug,
  Deserialize,
  Eq,
  PartialEq,
  Serialize,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
  bincode::Encode,
  bincode::Decode,
)]
#[serde(untagged)]
#[archive(check_bytes)]
pub enum IncludeNodeModules {
  Bool(bool),
  Array(Vec<String>),
  Map(HashMap<String, bool>),
}

impl Default for IncludeNodeModules {
  fn default() -> Self {
    IncludeNodeModules::Bool(true)
  }
}

impl From<EnvironmentContext> for IncludeNodeModules {
  fn from(context: EnvironmentContext) -> Self {
    match context {
      EnvironmentContext::Browser => IncludeNodeModules::Bool(true),
      EnvironmentContext::ServiceWorker => IncludeNodeModules::Bool(true),
      EnvironmentContext::WebWorker => IncludeNodeModules::Bool(true),
      _ => IncludeNodeModules::Bool(false),
    }
  }
}

impl Hash for IncludeNodeModules {
  fn hash<H: Hasher>(&self, state: &mut H) {
    match self {
      IncludeNodeModules::Bool(b) => b.hash(state),
      IncludeNodeModules::Array(a) => a.hash(state),
      IncludeNodeModules::Map(m) => {
        for (k, v) in m {
          k.hash(state);
          v.hash(state);
        }
      }
    }
  }
}

#[derive(
  Clone,
  Copy,
  Debug,
  Default,
  Deserialize_repr,
  Eq,
  Hash,
  PartialEq,
  Serialize_repr,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
  bincode::Encode,
  bincode::Decode,
)]
#[repr(u8)]
#[archive(check_bytes)]
pub enum SourceType {
  #[default]
  Module = 0,
  Script = 1,
}

/// Source map options for the target output
#[derive(
  Clone,
  Debug,
  Default,
  Deserialize,
  Eq,
  Hash,
  PartialEq,
  Serialize,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
  bincode::Encode,
  bincode::Decode,
)]
#[serde(rename_all = "camelCase")]
#[archive(check_bytes)]
pub struct TargetSourceMapOptions {
  /// Inlines the source map as a data URL into the bundle, rather than link to it as a separate output file
  inline: Option<bool>,

  /// Inlines the original source code into the source map, rather than loading them from the source root
  ///
  /// This is set to true by default when building browser targets for production.
  ///
  inline_sources: Option<bool>,

  /// The URL to load the original source code from
  ///
  /// This is set automatically in development when using the builtin Parcel development server.
  /// Otherwise, it defaults to a relative path to the bundle from the project root.
  ///
  source_root: Option<String>,
}
