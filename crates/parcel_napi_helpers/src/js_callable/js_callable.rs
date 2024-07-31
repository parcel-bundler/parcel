use std::sync::mpsc::channel;
#[cfg(debug_assertions)]
use std::thread::ThreadId;

use napi::threadsafe_function::ErrorStrategy;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUnknown;
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::map_params_serde;
use super::map_return_serde;
use super::JsValue;

pub type MapJsParams = Box<dyn FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + 'static>;
pub type MapJsReturn<Return> = Box<dyn Fn(&Env, JsUnknown) -> napi::Result<Return> + 'static>;

/// JsCallable provides a Send + Sync wrapper around callable JavaScript functions
///
/// Functions can be called from threads or the main thread, while parameters and return types can
/// be mapped by the caller.
pub struct JsCallable {
  #[cfg(debug_assertions)]
  initial_thread: ThreadId,
  name: String,
  threadsafe_function: ThreadsafeFunction<MapJsParams, ErrorStrategy::Fatal>,
}

impl JsCallable {
  pub fn new(callback: JsFunction, name: String) -> napi::Result<Self> {
    // Store the threadsafe function on the struct
    let tsfn: ThreadsafeFunction<MapJsParams, ErrorStrategy::Fatal> = callback
      .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<MapJsParams>| {
        (ctx.value)(&ctx.env)
      })?;

    Ok(Self {
      #[cfg(debug_assertions)]
      initial_thread: std::thread::current().id(),
      name,
      threadsafe_function: tsfn,
    })
  }

  /// Construct a JsCallable from an object property
  pub fn new_from_object_prop(method_name: &str, obj: &JsObject) -> napi::Result<Self> {
    Self::new(
      obj.get_named_property(method_name)?,
      method_name.to_string(),
    )
  }

  /// Construct a JsCallable from an object property, binding it to the source object
  pub fn new_from_object_prop_bound(method_name: &str, obj: &JsObject) -> napi::Result<Self> {
    let jsfn: JsFunction = obj.get_named_property(method_name)?;
    let fn_obj = jsfn.coerce_to_object()?;
    let bind: JsFunction = fn_obj.get_named_property("bind")?;
    let jsfn: JsFunction = bind.call(Some(&fn_obj), &[obj])?.try_into()?;
    Self::new(jsfn, method_name.to_string())
  }

  pub fn into_unref(mut self, env: &Env) -> napi::Result<Self> {
    self.threadsafe_function.unref(env)?;
    Ok(self)
  }

  /// Call JavaScript function and discard return value
  pub fn call(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + 'static,
  ) -> napi::Result<()> {
    #[cfg(debug_assertions)]
    if self.initial_thread == std::thread::current().id() {
      return Err(napi::Error::from_reason(format!(
        "Cannot run threadsafe function {} on main thread",
        self.name
      )));
    }

    self
      .threadsafe_function
      .call(Box::new(map_params), ThreadsafeFunctionCallMode::Blocking);

    Ok(())
  }

  pub fn call_serde<Params>(&self, params: Params) -> napi::Result<()>
  where
    Params: Serialize + Send + Sync + 'static,
  {
    self.call(map_params_serde(params))
  }

  /// Call JavaScript function and handle the return value
  pub fn call_with_return<Return>(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + 'static,
    map_return: impl Fn(&Env, JsUnknown) -> napi::Result<Return> + 'static,
  ) -> napi::Result<Return>
  where
    Return: Send + 'static,
  {
    #[cfg(debug_assertions)]
    if self.initial_thread == std::thread::current().id() {
      return Err(napi::Error::from_reason(format!(
        "Cannot run threadsafe function {} on main thread",
        self.name
      )));
    }

    let (tx, rx) = channel();

    self.threadsafe_function.call_with_return_value(
      Box::new(map_params),
      ThreadsafeFunctionCallMode::NonBlocking,
      move |JsValue(value, env)| {
        if value.is_promise()? {
          let result: JsObject = value.try_into()?;
          let then: JsFunction = result.get_named_property("then")?;

          let tx2 = tx.clone();
          let cb = env.create_function_from_closure("callback", move |ctx| {
            tx.send(map_return(&env, ctx.get::<JsUnknown>(0)?)).unwrap();
            ctx.env.get_undefined()
          })?;

          let eb = env.create_function_from_closure("error_callback", move |ctx| {
            let err = napi::Error::from(ctx.get::<JsUnknown>(0)?);
            tx2.send(Err(err)).expect("send failure");
            ctx.env.get_undefined()
          })?;

          then.call(Some(&result), &[cb, eb])?;
        } else if value.is_error()? {
          tx.send(Err(napi::Error::from(value))).unwrap();
        } else {
          tx.send(map_return(&env, value)).unwrap();
        }
        Ok(())
      },
    );

    rx.recv().unwrap()
  }

  pub fn call_with_return_serde<Params, Return>(&self, params: Params) -> napi::Result<Return>
  where
    Params: Serialize + Send + Sync + 'static,
    Return: Send + DeserializeOwned + 'static,
  {
    self.call_with_return(map_params_serde(params), map_return_serde())
  }
}
