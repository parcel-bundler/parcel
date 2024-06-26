use napi::Env;
use napi::JsObject;
use napi::JsUnknown;
use napi_derive::napi;

use parcel_core::plugin::{
  InitialAsset, RunTransformContext, TransformationInput, TransformerPlugin,
};
use parcel_plugin_transformer_js::ParcelJsTransformerPlugin;

use parcel_napi_helpers::anyhow_napi;

#[napi]
pub fn _testing_run_parcel_js_transformer_plugin(
  target_path: String,
  env: Env,
) -> napi::Result<JsUnknown> {
  let mut transformer = ParcelJsTransformerPlugin::new();
  let mut context = RunTransformContext::default();
  let input = TransformationInput::InitialAsset(InitialAsset {
    file_path: target_path.into(),
    ..Default::default()
  });
  let result = transformer
    .transform(&mut context, input)
    .map_err(anyhow_napi)?;
  let result = env.to_js_value(&result)?;
  Ok(result)
}

#[napi]
pub fn transform(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

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
