use std::collections::HashMap;

fn main() {
  let foo = std::fs::read_to_string("isbl.js").unwrap();

  let config = parcel_js_swc_core::Config {
    filename: "file.js".to_string(),
    code: foo.into_bytes(),
    module_id: "xyz".to_string(),
    project_root: "/app/".to_string(),
    replace_env: true,
    env: HashMap::new(),
    inline_fs: false,
    insert_node_globals: false,
    node_replacer: false,
    is_browser: false,
    is_worker: false,
    is_type_script: false,
    is_jsx: false,
    jsx_pragma: None,
    jsx_pragma_frag: None,
    automatic_jsx_runtime: false,
    jsx_import_source: None,
    decorators: false,
    use_define_for_class_fields: false,
    is_development: false,
    react_refresh: false,
    targets: None,
    source_maps: false,
    scope_hoist: false,
    source_type: parcel_js_swc_core::SourceType::Module,
    supports_module_workers: false,
    is_library: false,
    is_esm_output: false,
    trace_bailouts: false,
    is_swc_helpers: false,
    standalone: false,
    inline_constants: false,
  };

  rayon::scope(|scope| {
    scope.spawn(move |_| {
      let result = parcel_js_swc_core::transform(config, None).unwrap();
      println!("{:?}", String::from_utf8(result.code).unwrap());
    })
  });
}
