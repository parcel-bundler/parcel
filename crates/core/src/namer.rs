use crate::{Bundle, BundleGraph, Diagnostic, DiagnosticList, ParcelOptions, config::ParcelConfig};

pub trait Namer: Send + Sync {
  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    options: &ParcelOptions,
  ) -> Result<Option<String>, DiagnosticList>;
}

pub fn name(
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  config: &ParcelConfig,
  options: &ParcelOptions,
) -> Result<String, DiagnosticList> {
  for namer in &config.namers {
    if let Some(name) = namer.name(bundle_graph, bundle, options)? {
      return Ok(name);
    }
  }

  Err(
    Diagnostic {
      message: "Could not name bundle".into(),
      origin: Some("@parcel/core".into()),
      code_frames: vec![],
      hints: vec![],
      severity: crate::DiagnosticSeverity::Error,
      documentation_url: None,
    }
    .into(),
  )
}
