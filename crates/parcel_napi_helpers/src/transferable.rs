use std::any::Any;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;

use napi::bindgen_prelude::FromNapiValue;
use napi::bindgen_prelude::ToNapiValue;
use napi::Env;
use napi::JsString;
use napi::NapiRaw;
use once_cell::sync::Lazy;
use parking_lot::Mutex;

static COUNTER: AtomicUsize = AtomicUsize::new(0);
static VALUES: Lazy<Mutex<HashMap<String, Box<dyn Any + Send + Sync>>>> =
  Lazy::new(|| Default::default());

/// Creates an external reference to a Rust value and
/// makes it transferable across Nodejs workers
///
/// This is to get around the limitations of what can be transferred
/// between workers in Nodejs
///
/// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
pub struct Transferable<T> {
  id: String,
  _value: PhantomData<T>,
}

impl<T: Send + Sync + 'static> Transferable<T> {
  /// Put a Rust value into a Transferable container to allow
  /// sending values to Nodejs workers via postMessage or workerData
  pub fn new(value: T) -> Self {
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let id = format!("Transferable({})", id);

    VALUES.lock().insert(id.clone(), Box::new(value));
    Self {
      id,
      _value: Default::default(),
    }
  }

  /// Take value out of Transferable. It can no longer be accessed
  pub fn take(self) -> Result<T, ()> {
    let Some(value) = VALUES.lock().remove(&self.id) else {
      return Err(());
    };
    let Ok(val) = value.downcast::<T>() else {
      return Err(());
    };
    Ok(*val)
  }
}

/// Allows Transferable to be returned from a Napi functions
impl<T> ToNapiValue for Transferable<T> {
  unsafe fn to_napi_value(
    env: napi::sys::napi_env,
    val: Self,
  ) -> napi::Result<napi::sys::napi_value> {
    let env = Env::from_raw(env);
    let pointer = env.create_string(&val.id)?;
    Ok(pointer.raw())
  }
}

/// Allows Transferable to be accepted as an argument for a Napi function
impl<T> FromNapiValue for Transferable<T> {
  unsafe fn from_napi_value(
    env: napi::sys::napi_env,
    napi_val: napi::sys::napi_value,
  ) -> napi::Result<Self> {
    let pointer = JsString::from_napi_value(env, napi_val)?;
    let id = pointer.into_utf8()?.as_str()?.to_string();
    Ok(Self {
      id,
      _value: Default::default(),
    })
  }
}
