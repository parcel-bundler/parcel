use atlaspack_js_swc_core::{Config, TransformResult};

/// Parse a file with the `atlaspack_js_swc_core` parser for testing
pub(crate) fn run_swc_core_transform(source: &str) -> TransformResult {
  let swc_output = atlaspack_js_swc_core::transform(make_test_swc_config(source), None).unwrap();
  swc_output
}

/// SWC configuration for testing
pub(crate) fn make_test_swc_config(source: &str) -> Config {
  Config {
    source_type: atlaspack_js_swc_core::SourceType::Module,
    is_browser: true,
    filename: "something/file.js".to_string(),
    inline_fs: true,
    code: source.as_bytes().to_vec(),
    scope_hoist: true,
    ..Default::default()
  }
}
