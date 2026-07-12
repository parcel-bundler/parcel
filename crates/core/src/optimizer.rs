use std::sync::Arc;

use crate::{Bundle, Content, DiagnosticList, ParcelOptions, bundle_graph::BundleGraph};

pub trait Optimizer: Send + Sync {
  fn optimize(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn Content>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList>;
}
