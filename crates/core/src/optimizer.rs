use std::sync::Arc;

use crate::{Bundle, Content, DiagnosticList, ParcelOptions, bundle_graph::BundleGraph};

pub trait Optimizer: Send + Sync {
  /// Bundles whose names `optimize` may access for `bundle`. See `Content::bundle_dependencies`.
  #[allow(unused_variables)]
  fn bundle_dependencies(&self, bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
    Vec::new()
  }

  fn optimize(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn Content>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList>;
}
