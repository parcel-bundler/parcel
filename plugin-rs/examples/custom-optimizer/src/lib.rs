use parcel_plugin::{
  Bundle, BundleGraph, ContentBuffer, Diagnostic, OptimizeResult, Options, Plugin, register_plugin,
};

struct CustomOptimizer;

impl Plugin for CustomOptimizer {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(Self)
  }

  fn optimize(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    contents: &[u8],
    source_map: Option<&[u8]>,
    _options: &Options,
  ) -> Result<OptimizeResult, Diagnostic> {
    let contents = std::str::from_utf8(contents)
      .map_err(|error| Diagnostic::new(format!("bundle was not UTF-8: {error}")))?;
    let contents = format!(
      "/* optimized by Rust: assets={} bundles={} type={} map={} */\n{}",
      bundle_graph.asset_count(),
      bundle_graph.bundle_count(),
      bundle.asset_type(),
      source_map.is_some(),
      contents,
    );

    Ok(OptimizeResult {
      contents: ContentBuffer::String(contents),
      source_map: source_map.map(<[u8]>::to_vec),
    })
  }
}

register_plugin!(CustomOptimizer);
