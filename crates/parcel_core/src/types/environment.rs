use std::num::NonZeroU32;

use bitflags::bitflags;
use parcel_resolver::IncludeNodeModules;
use serde::Deserialize;
use serde::Serialize;
use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

use self::engines::Engines;
use super::source::SourceLocation;
use crate::bitflags_serde;

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
#[derive(Clone, Debug, Deserialize, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
  /// The environment the output should run in
  pub context: EnvironmentContext,

  /// The engines supported by the environment
  pub engines: Engines,

  /// Togglable options that change the build output
  pub flags: EnvironmentFlags,

  /// Describes which node_modules should be included in the output
  pub include_node_modules: IncludeNodeModules,

  pub loc: Option<SourceLocation>,

  /// Determines what type of module to output
  pub output_format: OutputFormat,

  /// Configures source maps, which are enabled by default
  pub source_map: Option<TargetSourceMapOptions>,

  pub source_type: SourceType,
}

impl std::hash::Hash for Environment {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    // Hashing intentionally does not include loc
    self.context.hash(state);
    self.engines.hash(state);
    self.flags.hash(state);
    self.include_node_modules.hash(state);
    self.output_format.hash(state);
    self.source_map.hash(state);
    self.source_type.hash(state);
  }
}

impl PartialEq for Environment {
  fn eq(&self, other: &Self) -> bool {
    // Equality intentionally does not include loc
    self.context == other.context
      && self.engines == other.engines
      && self.flags == other.flags
      && self.include_node_modules == other.include_node_modules
      && self.output_format == other.output_format
      && self.source_map == other.source_map
      && self.source_type == other.source_type
  }
}

/// The environment the output should run in
///
/// This informs Parcel what environment-specific APIs are available.
///
#[derive(Clone, Copy, Debug, Deserialize_repr, Eq, Hash, PartialEq, Serialize_repr)]
#[repr(u8)]
pub enum EnvironmentContext {
  Browser = 0,
  ElectronMain = 1,
  ElectronRenderer = 2,
  Node = 3,
  ServiceWorker = 4,
  WebWorker = 5,
  Worklet = 6,
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

bitflags! {
  /// Togglable options that change the build output
  #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
  pub struct EnvironmentFlags: u8 {
    /// Treats the target as a library that would be published to npm and consumed by another tool,
    /// rather than used directly in a browser or other target environment.
    ///
    /// Library targets must enable scope hoisting, and use a non-global output format.
    ///
    const IS_LIBRARY = 1 << 0;

    /// Determines whether the output should be optimised
    ///
    /// The exact behavior of this flag is determined by plugins. By default, optimization is
    /// enabled during production builds for application targets.
    ///
    const SHOULD_OPTIMIZE = 1 << 1;

    /// Determines whether scope hoisting should be enabled
    ///
    /// By default, scope hoisting is enabled for production builds.
    ///
    const SHOULD_SCOPE_HOIST = 1 << 2;
  }
}

bitflags_serde!(EnvironmentFlags);

#[derive(PartialEq, Eq, Clone, Copy, Debug, Deserialize_repr, Hash, Serialize_repr)]
#[repr(u8)]
pub enum SourceType {
  Module = 0,
  Script = 1,
}

/// Source map options for the target output
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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
