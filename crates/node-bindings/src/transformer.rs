use napi::bindgen_prelude::Buffer;
use napi::Env;
use napi::JsObject;
use napi::JsUnknown;
use napi_derive::napi;

#[napi]
pub fn transform(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let config = parcel_js_swc_core::Config {
    filename: opts.get_named_property("filename")?,
    code: opts.get_named_property::<Buffer>("code")?.as_ref().to_vec(),
    module_id: opts.get_named_property("module_id")?,
    project_root: opts.get_named_property("project_root")?,
    replace_env: opts.get_named_property("replace_env")?,
    env: env.from_js_value(opts.get_named_property::<JsObject>("env")?)?,
    inline_fs: opts.get_named_property("inline_fs")?,
    insert_node_globals: opts.get_named_property("insert_node_globals")?,
    node_replacer: opts.get_named_property("node_replacer")?,
    is_browser: opts.get_named_property("is_browser")?,
    is_worker: opts.get_named_property("is_worker")?,
    is_type_script: opts.get_named_property("is_type_script")?,
    is_jsx: opts.get_named_property("is_jsx")?,
    jsx_pragma: opts.get_named_property("jsx_pragma")?,
    jsx_pragma_frag: opts.get_named_property("jsx_pragma_frag")?,
    automatic_jsx_runtime: opts.get_named_property("automatic_jsx_runtime")?,
    jsx_import_source: opts.get_named_property("jsx_import_source")?,
    decorators: opts.get_named_property("decorators")?,
    use_define_for_class_fields: opts.get_named_property("use_define_for_class_fields")?,
    is_development: opts.get_named_property("is_development")?,
    react_refresh: opts.get_named_property("react_refresh")?,
    targets: opts.get_named_property("targets")?,
    source_maps: opts.get_named_property("source_maps")?,
    scope_hoist: opts.get_named_property("scope_hoist")?,
    source_type: match opts.get_named_property("source_type")? {
      "Module" => parcel_js_swc_core::SourceType::Module,
      "Script" => parcel_js_swc_core::SourceType::Script,
      _ => panic!("Invalid source type"),
    },
    supports_module_workers: opts.get_named_property("supports_module_workers")?,
    is_library: opts.get_named_property("is_library")?,
    is_esm_output: opts.get_named_property("is_esm_output")?,
    trace_bailouts: opts.get_named_property("trace_bailouts")?,
    is_swc_helpers: opts.get_named_property("is_swc_helpers")?,
    standalone: opts.get_named_property("standalone")?,
    inline_constants: opts.get_named_property("inline_constants")?,
  };

  let result = parcel_js_swc_core::transform(config, None)?;
  env.to_js_value(&result)
}

#[cfg(not(target_arch = "wasm32"))]
mod native_only {
  use parcel_macros::napi::create_macro_callback;

  use super::*;

  #[napi]
  pub fn transform_async(opts: JsObject, env: Env) -> napi::Result<JsObject> {
    let call_macro = if opts.has_named_property("callMacro")? {
      let func = opts.get_named_property::<JsUnknown>("callMacro")?;
      if let Ok(func) = func.try_into() {
        Some(create_macro_callback(func, env)?)
      } else {
        None
      }
    } else {
      None
    };

    let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;
    let (deferred, promise) = env.create_deferred()?;

    rayon::spawn(move || {
      let res = parcel_js_swc_core::transform(config, call_macro);
      match res {
        Ok(result) => deferred.resolve(move |env| env.to_js_value(&result)),
        Err(err) => deferred.reject(err.into()),
      }
    });

    Ok(promise)
  }
}
