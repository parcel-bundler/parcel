use napi::Env;
use napi::JsObject;
use napi::JsUnknown;
use napi_derive::napi;

#[napi]
pub fn transform(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

  let result = parcel_js_swc_core::transform(config, None)?;
  env.to_js_value(&result)
}
