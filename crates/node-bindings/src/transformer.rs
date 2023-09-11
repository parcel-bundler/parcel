use napi::{Env, JsObject, JsUnknown, Result};
use napi_derive::napi;

#[napi]
pub fn transform(opts: JsObject, env: Env) -> Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

  let result = parcel_js_swc_core::transform(config)?;
  env.to_js_value(&result)
}

#[cfg(not(target_arch = "wasm32"))]
#[napi]
pub fn transform_async(opts: JsObject, env: Env) -> Result<JsObject> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;
  let (deferred, promise) = env.create_deferred()?;

  rayon::spawn(move || {
    let res = parcel_js_swc_core::transform(config);
    match res {
      Ok(result) => deferred.resolve(move |env| env.to_js_value(&result)),
      Err(err) => deferred.reject(err.into()),
    }
  });

  Ok(promise)
}
