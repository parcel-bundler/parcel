use std::sync::Arc;

use crate::{Bundle, Content, Diagnostic, bundle_graph::BundleGraph, config::JsPlugin};

pub trait Optimizer: Send + Sync {
  fn optimize(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: Arc<dyn Content>,
  ) -> Result<Arc<dyn Content>, Vec<Diagnostic>>;
}

impl Optimizer for JsPlugin {
  fn optimize(
    &self,
    _bundle_graph: &BundleGraph,
    _bundle: &Bundle,
    _contents: Arc<dyn Content>,
  ) -> Result<Arc<dyn Content>, Vec<Diagnostic>> {
    Err(vec![])
  }
}
