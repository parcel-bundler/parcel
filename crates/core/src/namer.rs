use crate::{
  Bundle, Diagnostic, DiagnosticList, ParcelOptions, asset_graph::AssetGraph, config::ParcelConfig,
};

pub trait Namer: Send + Sync {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &Bundle,
    options: &ParcelOptions,
  ) -> Result<Option<String>, DiagnosticList>;
}

pub fn name(
  asset_graph: &AssetGraph,
  bundle: &Bundle,
  config: &ParcelConfig,
  options: &ParcelOptions,
) -> Result<String, DiagnosticList> {
  for namer in &config.namers {
    if let Some(name) = namer.name(asset_graph, bundle, options)? {
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
