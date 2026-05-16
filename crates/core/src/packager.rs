use std::sync::Arc;

use crate::{
  Bundle, Content, Diagnostic, DiagnosticList, ParcelOptions, bundle_graph::BundleGraph,
};

pub trait Packager: Send + Sync {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList>;
}

pub struct RawPackager {}

impl Packager for RawPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    _options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    if bundle.assets.len() != 1 {
      return Err(
        Diagnostic {
          message: "Raw bundles must only contain one asset".into(),
          code_frames: vec![],
          origin: Some("@parcel/package-raw".into()),
          documentation_url: None,
          hints: vec![],
          severity: crate::DiagnosticSeverity::Error,
        }
        .into(),
      );
    }

    Ok(
      bundle_graph.asset_graph.assets[bundle.assets[0]]
        .expect_asset()
        .content
        .clone(),
    )
  }
}
