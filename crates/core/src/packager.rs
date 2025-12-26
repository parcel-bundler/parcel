use std::sync::Arc;

use crate::{Bundle, Content, Diagnostic, bundle_graph::BundleGraph, config::JsPlugin};

pub trait Packager: Send + Sync {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, Vec<Diagnostic>>,
  ) -> Result<Arc<dyn Content>, Vec<Diagnostic>>;
}

impl Packager for JsPlugin {
  fn package(
    &self,
    _bundle_graph: &BundleGraph,
    _bundle: &Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, Vec<Diagnostic>>,
  ) -> Result<Arc<dyn Content>, Vec<Diagnostic>> {
    Err(vec![])
  }
}

struct RawPackager {}

impl Packager for RawPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, Vec<Diagnostic>>,
  ) -> Result<Arc<dyn Content>, Vec<Diagnostic>> {
    if bundle.assets.len() != 1 {
      return Err(vec![Diagnostic {
        message: "Raw bundles must only contain one asset".into(),
        code_frames: vec![],
        origin: Some("@parcel/package-raw".into()),
        documentation_url: None,
        hints: vec![],
        severity: crate::DiagnosticSeverity::Error,
      }]);
    }

    Ok(
      bundle_graph.asset_graph.assets[bundle.assets[0]]
        .as_ref()
        .unwrap()
        .content
        .clone(),
    )
  }
}
