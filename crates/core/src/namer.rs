use crate::{
  Bundle, Diagnostic,
  asset_graph::AssetGraph,
  config::{JsPlugin, ParcelConfig},
};

pub trait Namer: Send + Sync {
  fn name(
    &self,
    asset_graph: &AssetGraph,
    bundle: &Bundle,
  ) -> Result<Option<String>, Vec<Diagnostic>>;
}

impl Namer for JsPlugin {
  fn name(
    &self,
    _asset_graph: &AssetGraph,
    _bundle: &Bundle,
  ) -> Result<Option<String>, Vec<Diagnostic>> {
    Err(vec![])
  }
}

pub fn name(
  asset_graph: &AssetGraph,
  bundle: &Bundle,
  config: &ParcelConfig,
) -> Result<String, Vec<Diagnostic>> {
  for namer in &config.namers {
    if let Some(name) = namer.plugin.name(asset_graph, bundle)? {
      return Ok(name);
    }
  }

  Err(vec![Diagnostic {
    message: "Could not name bundle".into(),
    origin: Some("@parcel/core".into()),
    code_frames: vec![],
    hints: vec![],
    severity: crate::DiagnosticSeverity::Error,
    documentation_url: None,
  }])
}
