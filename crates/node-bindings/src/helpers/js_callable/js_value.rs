use napi::bindgen_prelude::FromNapiValue;
use napi::sys::napi_env;
use napi::sys::napi_value;
use napi::Env;
use napi::JsUnknown;

/// ## Safety
/// This will do unsafe casting of a raw env pointer in order to access it
/// from the underlying napi type. This is safe because the napi types cannot be
/// sent to a non-main thread and is how other NapiValue types work too.
pub struct JsValue(pub JsUnknown, pub Env);

impl FromNapiValue for JsValue {
  unsafe fn from_napi_value(env: napi_env, value: napi_value) -> napi::Result<Self> {
    let value = JsUnknown::from_napi_value(env, value)?;
    let env = Env::from_raw(env);
    Ok(Self(value, env))
  }
}
