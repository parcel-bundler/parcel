use crate::{
  Bundle, Diagnostic, DiagnosticList,
  asset_graph::AssetGraph,
  config::{JsPlugin, ParcelConfig},
};

pub trait Namer: Send + Sync {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &Bundle,
  ) -> Result<Option<String>, DiagnosticList>;
}

impl Namer for JsPlugin {
  fn name(
    &self,
    _asset_graph: &AssetGraph,
    _bundle: &Bundle,
  ) -> Result<Option<String>, DiagnosticList> {
    Err(DiagnosticList(vec![]))
  }
}

pub fn name(
  asset_graph: &AssetGraph,
  bundle: &Bundle,
  config: &ParcelConfig,
) -> Result<String, DiagnosticList> {
  for namer in &config.namers {
    if let Some(name) = namer.name(asset_graph, bundle)? {
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
