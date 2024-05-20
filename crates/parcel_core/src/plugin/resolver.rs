use std::path::PathBuf;

use super::PluginContext;
use crate::types::Dependency;
use crate::types::JSONObject;
use crate::types::Priority;

// TODO Diagnostics and invalidations

pub struct Resolution {
  /// Whether this dependency can be deferred by Parcel itself
  pub can_defer: bool,

  /// The code of the resolved asset
  ///
  /// If provided, this is used rather than reading the file from disk.
  ///
  pub code: Option<String>,

  /// An absolute path to the resolved file
  pub file_path: PathBuf,

  /// Whether the resolved file should be excluded from the build
  pub is_excluded: bool,

  /// Is spread (shallowly merged) onto the request's dependency.meta
  pub meta: JSONObject,

  /// An optional named pipeline to use to compile the resolved file
  pub pipeline: Option<String>,

  /// Overrides the priority set on the dependency
  pub priority: Option<Priority>,

  /// Corresponds to the asset side effects
  pub side_effects: bool,

  /// Query parameters to be used by transformers when compiling the resolved file
  pub query: Option<String>,
}

/// Converts a dependency specifier into a file path that will be processed by transformers
///
/// Resolvers run in a pipeline until one of them return a result.
///
pub trait ResolverPlugin: Send + Sync {
  /// Determines what the dependency specifier resolves to
  fn resolve(
    &self,
    specifier: &str,
    dependency: &Dependency,
    pipeline: Option<&str>,
    context: &PluginContext,
  ) -> Result<Resolution, anyhow::Error>;
}
