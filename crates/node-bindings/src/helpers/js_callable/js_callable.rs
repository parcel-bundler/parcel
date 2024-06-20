use std::sync::mpsc::channel;
use std::thread::ThreadId;

use napi::threadsafe_function::ErrorStrategy;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUnknown;

use super::local_functions::get_local_function;
use super::local_functions::remove_local_function;
use super::local_functions::set_local_function;
use super::JsValue;

pub type JsMapInput = Box<dyn FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send>;

/// JsCallable provides a Send + Sync wrapper around callable JavaScript functions.
/// Functions can be called from threads or the main thread.
/// Parameters and return types will automatically be converted using serde.
pub struct JsCallable {
  initial_thread: ThreadId,
  tsfn: ThreadsafeFunction<JsMapInput, ErrorStrategy::Fatal>,
  callback: usize,
}

impl JsCallable {
  pub fn new(callback: JsFunction) -> napi::Result<Self> {
    let initial_thread = std::thread::current().id();

    // Store the threadsafe function on the struct
    let tsfn: ThreadsafeFunction<JsMapInput, ErrorStrategy::Fatal> = callback
      .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<JsMapInput>| {
        (ctx.value)(&ctx.env)
      })?;

    // Store the local thread function in a local key
    let index = set_local_function(callback)?;

    Ok(Self {
      initial_thread,
      tsfn,
      callback: index,
    })
  }

  /// Construct a JsCallable from an object property
  pub fn new_from_object_prop(method_name: &str, obj: &JsObject) -> napi::Result<Self> {
    Self::new(obj.get_named_property(method_name)?)
  }

  /// Construct a JsCallable from an object property, binding it to the source object
  pub fn new_from_object_prop_bound(method_name: &str, obj: &JsObject) -> napi::Result<Self> {
    let jsfn: JsFunction = obj.get_named_property(method_name)?;
    let fn_obj = jsfn.coerce_to_object()?;
    let bind: JsFunction = fn_obj.get_named_property("bind")?;
    let jsfn: JsFunction = bind.call(Some(&fn_obj), &[obj])?.try_into()?;
    Self::new(jsfn)
  }

  /// Call JavaScript function and discard return value
  pub fn call<Return: Send + 'static>(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
  ) -> napi::Result<()> {
    if self.initial_thread == std::thread::current().id() {
      self.call_local(map_params)
    } else {
      self.call_thread(map_params)
    }
  }

  pub fn call_with_return<Return: Send + 'static>(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
    map_return: impl Fn(&Env, JsUnknown) -> napi::Result<Return> + Send + 'static,
  ) -> napi::Result<Return> {
    if self.initial_thread == std::thread::current().id() {
      self.call_local_with_return(map_params, map_return)
    } else {
      self.call_thread_with_return(map_params, map_return)
    }
  }

  pub fn call_local(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
  ) -> napi::Result<()> {
    self.call_local_with_return(map_params, |_, _| Ok(()))
  }

  pub fn call_local_with_return<Return: Send + 'static>(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
    map_return: impl Fn(&Env, JsUnknown) -> napi::Result<Return> + Send + 'static,
  ) -> napi::Result<Return> {
    let (callback, env) = get_local_function(&self.callback)?.unwrap();

    let params = map_params(&env)?;
    let returned = callback.call(None, &params)?;
    map_return(&env, returned)
  }

  pub fn call_thread(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
  ) -> napi::Result<()> {
    self.tsfn.call(
      Box::new(map_params),
      ThreadsafeFunctionCallMode::NonBlocking,
    );

    Ok(())
  }

  pub fn call_thread_with_return<Return: Send + 'static>(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
    map_return: impl Fn(&Env, JsUnknown) -> napi::Result<Return> + Send + 'static,
  ) -> napi::Result<Return> {
    let (tx, rx) = channel();

    self.tsfn.call_with_return_value(
      Box::new(map_params),
      ThreadsafeFunctionCallMode::NonBlocking,
      move |JsValue(value, env)| {
        tx.send(map_return(&env, value)).unwrap();
        Ok(())
      },
    );

    rx.recv().unwrap()
  }
}

impl Drop for JsCallable {
  fn drop(&mut self) {
    remove_local_function(&self.callback)
  }
}
