use napi::bindgen_prelude::FromNapiValue;
use napi::sys::napi_env;
use napi::sys::napi_value;
use napi::Env;
use napi::JsUnknown;
use napi::NapiRaw;
use napi::NapiValue;
use std::panic;

pub struct JsValue(pub JsUnknown, pub Env);

impl JsValue {
  pub fn cast<T: NapiValue>(&self) -> napi::Result<T> {
    if let Ok(result) = panic::catch_unwind::<_, T>(|| unsafe { self.0.cast() }) {
      Ok(result)
    } else {
      Err(napi::Error::from_reason("Unable to cast type"))
    }
  }
}

impl FromNapiValue for JsValue {
  unsafe fn from_napi_value(env: napi_env, value: napi_value) -> napi::Result<Self> {
    let value = JsUnknown::from_napi_value(env, value)?;
    let env = Env::from_raw(env);
    Ok(Self(value, env))
  }
}

impl NapiRaw for JsValue {
  unsafe fn raw(&self) -> napi_value {
    self.0.raw()
  }
}
