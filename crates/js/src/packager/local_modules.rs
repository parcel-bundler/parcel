use parcel_core::*;
use rustc_hash::FxHashMap;

use super::ModuleId;
use crate::JsContent;

/// The modules of a bundle that nothing outside it refers to (see
/// `BundleGraph::is_bundle_private`), numbered in bundle order. They're required by their numbers
/// and kept in a table of their own, which only the bundle's own require reads (see `runtime.js`).
/// A number is shorter than a hashed id, and numbers in order compress far better, while global ids
/// keep their names stable across builds where other bundles see them.
#[derive(Default)]
pub struct LocalModules(FxHashMap<AssetIndex, u32>);

impl LocalModules {
  /// Async modules' imports are required by id through the runtime's async module evaluator, so a
  /// bundle with any keeps every module's global id, as do bundles whose modules other code names
  /// by id (classic scripts, React Server Components, hot updates).
  pub fn new(
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    has_script: bool,
    should_optimize: bool,
    options: &ParcelOptions,
  ) -> Self {
    if !should_optimize
      || options.hmr.is_some()
      || has_script
      || matches!(
        bundle.target.environment,
        Environment::ReactServer | Environment::ReactClient
      )
      || bundle
        .assets
        .iter()
        .any(|&index| bundle_graph.is_async_asset(index))
    {
      return Self::default();
    }
    LocalModules(
      bundle
        .assets
        .iter()
        .copied()
        .filter(|&index| {
          // Modules with other content (e.g. from plugins) aren't written as functions.
          bundle_graph
            .asset_graph
            .asset(index)
            .content
            .downcast_ref::<JsContent>()
            .is_some()
            && bundle_graph.is_bundle_private(index)
        })
        .zip(0..)
        .collect(),
    )
  }

  /// How modules in the bundle require `asset`.
  pub fn id<'a>(&self, bundle_graph: &'a BundleGraph, asset: AssetIndex) -> ModuleId<'a> {
    match self.0.get(&asset) {
      Some(&index) => ModuleId::Local(index),
      None => bundle_graph.asset_id(asset).into(),
    }
  }
}
