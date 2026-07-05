use crate::{
  Bundle, BundleGraph, Diagnostic, DiagnosticList, ParcelOptions, PathId, config::ParcelConfig,
};

pub trait Namer: Send + Sync {
  /// Returns the bundle's full dist path: the chosen name (which may include subdirectories)
  /// joined onto the bundle target's dist dir and interned.
  fn name(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    options: &ParcelOptions,
  ) -> Result<Option<PathId>, DiagnosticList>;
}

pub fn name(
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  config: &ParcelConfig,
  options: &ParcelOptions,
) -> Result<PathId, DiagnosticList> {
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
