use std::sync::Arc;

use crate::{Bundle, Content, DiagnosticList, bundle_graph::BundleGraph};

pub trait Optimizer: Send + Sync {
  fn optimize(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn Content>,
  ) -> Result<Arc<dyn Content>, DiagnosticList>;
}
