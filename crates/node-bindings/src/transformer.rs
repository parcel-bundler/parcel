use napi::{Env, JsObject, JsUnknown, Result};
use napi_derive::napi;

#[napi]
pub fn transform(opts: JsObject, env: Env) -> Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

  let result = parcel_js_swc_core::transform(config)?;
  env.to_js_value(&result)
}
