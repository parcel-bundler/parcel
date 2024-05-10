use std::fmt::Debug;
use std::path::Path;
use std::path::PathBuf;
use std::ptr;
use std::rc::Rc;

use napi::bindgen_prelude::FromNapiValue;
use napi::bindgen_prelude::ToNapiValue;
use napi::Env;
use napi::JsObject;
use napi::JsString;
use napi::NapiRaw;
use parcel_napi_helpers::call_method;
use parcel_napi_helpers::console_log;

use crate::PackageManager;
use crate::Resolution;
use crate::ResolveError;

#[derive(Debug)]
pub struct ResolutionFuture {
  resolved: String,
}

impl FromNapiValue for ResolutionFuture {
  unsafe fn from_napi_value(
    env: napi::sys::napi_env,
    napi_val: napi::sys::napi_value,
  ) -> napi::Result<Self> {
    let obj = JsObject::from_napi_value(env, napi_val)?;

    Ok(ResolutionFuture {
      resolved: obj.get("resolved")?.unwrap(),
    })
  }
}

impl ToNapiValue for ResolutionFuture {
  unsafe fn to_napi_value(
    env: napi::sys::napi_env,
    val: Self,
  ) -> napi::Result<napi::sys::napi_value> {
    let mut ptr = ptr::null_mut();
    unsafe {
      napi::sys::napi_create_object(env, &mut ptr);
    }

    let mut obj = JsObject::from_napi_value(env, ptr)?;

    obj.set("resolved", val.resolved)?;

    Ok(obj.raw())
  }
}

/// An implementation of `PackageManager` that delegates calls to a `JsObject`.
pub struct JsPackageManager {
  env: Rc<Env>,
  js_delegate: JsObject,
}

impl JsPackageManager {
  pub fn new(env: Rc<Env>, js_delegate: JsObject) -> Self {
    Self { env, js_delegate }
  }
}

fn run_with_errors<T>(block: impl FnOnce() -> Result<T, napi::Error>) -> Result<T, ResolveError> {
  let result = block();
  result.map_err(|err| ResolveError::JsError(err.reason))
}

impl PackageManager for JsPackageManager {
  fn resolve(&self, specifier: &str, from: &Path) -> Result<Resolution, ResolveError> {
    let resolution = run_with_errors(|| {
      let js_from = self.env.create_string(from.as_os_str().to_str().unwrap())?;
      let js_specifier = self.env.create_string(specifier)?;

      let resolution = call_method(
        &self.env,
        &self.js_delegate,
        "resolveSync",
        &[&js_specifier.into_unknown(), &js_from.into_unknown()],
      )?;

      let resolution = JsObject::from_unknown(resolution)?;
      let resolved: String = resolution.get("resolved")?.unwrap();

      Ok(Resolution {
        resolved: PathBuf::from(resolved),
      })
    })?;

    Ok(resolution)
  }
}
