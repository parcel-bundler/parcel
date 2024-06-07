use std::fmt::Debug;
use std::path::PathBuf;
use std::sync::Arc;

use dyn_hash::DynHash;

use crate::request_tracker::Invalidation;
use crate::types::Dependency;
use crate::types::JSONObject;
use crate::types::Priority;

// TODO Diagnostics and invalidations

pub struct ResolveContext {
  pub dependency: Arc<Dependency>,
  pub pipeline: Option<String>,
  pub specifier: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResolvedResolution {
  /// Whether this dependency can be deferred by Parcel itself
  pub can_defer: bool,

  /// The code of the resolved asset
  ///
  /// If provided, this is used rather than reading the file from disk.
  ///
  pub code: Option<String>,

  /// An absolute path to the resolved file
  pub file_path: PathBuf,

  /// Is spread (shallowly merged) onto the request's dependency.meta
  pub meta: Option<JSONObject>,

  /// An optional named pipeline to compile the resolved file
  pub pipeline: Option<String>,

  /// Overrides the priority set on the dependency
  pub priority: Option<Priority>,

  /// Query parameters to be used by transformers when compiling the resolved file
  pub query: Option<String>,

  /// Corresponds to the asset side effects
  pub side_effects: bool,
}

#[derive(Debug, PartialEq)]
pub enum Resolution {
  /// Indicates the dependency was not resolved
  Unresolved,

  /// Whether the resolved file should be excluded from the build
  Excluded,

  Resolved(ResolvedResolution),
}

#[derive(Debug, PartialEq)]
pub struct Resolved {
  pub invalidations: Vec<Invalidation>,
  pub resolution: Resolution,
}

/// Converts a dependency specifier into a file path that will be processed by transformers
///
/// Resolvers run in a pipeline until one of them return a result.
///
pub trait ResolverPlugin: Debug + DynHash + Send + Sync {
  /// Determines what the dependency specifier resolves to
  fn resolve(&self, ctx: ResolveContext) -> Result<Resolved, anyhow::Error>;
}

dyn_hash::hash_trait_object!(ResolverPlugin);

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug, Hash)]
  struct TestResolverPlugin {}

  impl ResolverPlugin for TestResolverPlugin {
    fn resolve(&self, _ctx: ResolveContext) -> Result<Resolved, anyhow::Error> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut resolvers = Vec::<Box<dyn ResolverPlugin>>::new();

    resolvers.push(Box::new(TestResolverPlugin {}));

    assert_eq!(resolvers.len(), 1);
  }
}
