use std::cell::RefCell;
use std::collections::HashMap;
use std::panic;
use std::rc::Rc;
use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::thread::ThreadId;

use super::JsValue;
use erased_serde::Serialize as ErasedSerialize;
use napi::bindgen_prelude::Array;
use napi::bindgen_prelude::FromNapiValue;
use napi::threadsafe_function::ErrorStrategy;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUnknown;
use napi::NapiRaw;
use serde::de::DeserializeOwned;
use serde::Serialize;

thread_local! {
  /// Storage for napi JavaScript functions on the local thread
  static LOCAL_FUNCTIONS: (RefCell<usize>, RefCell<HashMap<usize, Rc<JsValue>>>) = Default::default();
}

/// JsCallable provides a Send + Sync wrapper around callable JavaScript functions.
/// Functions can be called from threads or the main thread.
/// Parameters and return types will automatically be converted using serde.
pub struct JsCallable {
  initial_thread: ThreadId,
  tsfn: ThreadsafeFunction<Box<dyn ErasedSerialize>, ErrorStrategy::Fatal>,
  callback: usize,
}

impl JsCallable {
  pub fn new(callback: JsFunction) -> napi::Result<Self> {
    let initial_thread = std::thread::current().id();

    // Store the threadsafe function on the struct
    let tsfn: ThreadsafeFunction<Box<dyn ErasedSerialize>, ErrorStrategy::Fatal> = callback
      .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<Box<dyn ErasedSerialize>>| {
        let result = ctx.env.to_js_value(&ctx.value)?;
        if result.is_array()? {
          // SAFETY: type assertion above
          let result = panic::catch_unwind::<_, napi::Result<Array>>(|| unsafe {
            Array::from_napi_value(ctx.env.raw(), result.raw())
          })
          .map_err(|_| napi::Error::from_reason("Unable to cast to array"))??;

          let mut args = vec![];

          for index in 0..result.len() {
            let Some(item) = result.get::<JsUnknown>(index)? else {
              return Err(napi::Error::from_reason("Error calculating params"));
            };
            args.push(item)
          }

          Ok(args)
        } else {
          Ok(vec![result])
        }
      })?;

    // Store the local thread function in a local key
    let index = LOCAL_FUNCTIONS.with(move |(counter, map)| -> napi::Result<usize> {
      let mut counter = counter.borrow_mut();
      let mut map = map.borrow_mut();

      let index = counter.clone();
      let value = JsValue::from_unknown(callback.into_unknown())?;
      map.insert(index.clone(), Rc::new(value));

      *counter += 1;
      Ok(index)
    })?;

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
  pub fn call<Params: Serialize + 'static>(&self, params: Params) -> napi::Result<()> {
    if self.initial_thread == std::thread::current().id() {
      self.call_local(params).map(|_| ())
    } else {
      self.call_thread(params)
    }
  }

  /// Call JavaScript function and deserialize return value
  pub fn call_with_return<
    Params: Serialize + 'static,
    Response: Send + DeserializeOwned + 'static,
  >(
    &self,
    params: Params,
  ) -> napi::Result<Response> {
    if self.initial_thread == std::thread::current().id() {
      self.call_local_with_return(params)
    } else {
      self.call_thread_with_return(params)
    }
  }

  /// Call JavaScript local function and discard return value.
  /// Will error if used off the main thread
  pub fn call_local<Params: Serialize + 'static>(
    &self,
    params: Params,
  ) -> napi::Result<(JsUnknown, Env)> {
    #[cfg(debug_assertions)]
    if self.initial_thread != std::thread::current().id() {
      return Err(napi::Error::from_reason(
        "Cannot run local function on another thread",
      ));
    }

    let value = LOCAL_FUNCTIONS.with(move |(_, map)| {
      let map = map.borrow();
      let Some(callback) = map.get(&self.callback) else {
        return Err(napi::Error::from_reason("Missing callback"));
      };
      Ok(callback.clone())
    })?;

    let env = value.1;
    let callback = value.cast::<JsFunction>()?;

    let mut args = vec![];

    let result = env.to_js_value(&params)?;
    if result.is_array()? {
      // SAFETY: type assertion above
      let result = panic::catch_unwind::<_, napi::Result<Array>>(|| unsafe {
        Array::from_napi_value(env.raw(), result.raw())
      })
      .map_err(|_| napi::Error::from_reason("Unable to cast to array"))??;

      for index in 0..result.len() {
        let item = result.get::<JsUnknown>(index)?.unwrap(); // TODO
        args.push(item)
      }
    } else {
      args.push(result)
    }

    let result = callback.call::<JsUnknown>(None, &args)?;

    #[cfg(debug_assertions)]
    if result.is_promise()? {
      return Err(napi::Error::from_reason(
        "Function returns promise and must be run off of the main thread",
      ));
    }

    Ok((result, env))
  }

  /// Call JavaScript local function and deserialize return value.
  /// Will error if used off the main thread
  pub fn call_local_with_return<
    Params: Serialize + 'static,
    Response: Send + DeserializeOwned + 'static,
  >(
    &self,
    params: Params,
  ) -> napi::Result<Response> {
    let (result, env) = self.call_local(params)?;
    env.from_js_value::<Response, JsUnknown>(result)
  }

  /// Call JavaScript thread safe function and discard return value.
  /// Will error if used on of the main thread
  pub fn call_thread<Params: Serialize + 'static>(&self, params: Params) -> napi::Result<()> {
    self.call_thread_internal::<_, ()>(params, None)
  }

  /// Call JavaScript thread safe function and deserialize return value.
  /// Will error if used on the main thread
  pub fn call_thread_with_return<
    Params: Serialize + 'static,
    Response: Send + DeserializeOwned + 'static,
  >(
    &self,
    params: Params,
  ) -> napi::Result<Response> {
    let (tx, rx) = channel();
    self.call_thread_internal(params, Some(tx))?;
    rx.recv().unwrap()
  }

  fn call_thread_internal<
    Params: Serialize + 'static,
    Response: Send + DeserializeOwned + 'static,
  >(
    &self,
    params: Params,
    tx: Option<Sender<napi::Result<Response>>>,
  ) -> napi::Result<()> {
    #[cfg(debug_assertions)]
    if self.initial_thread == std::thread::current().id() {
      return Err(napi::Error::from_reason(
        "Cannot run threadsafe function on main thread",
      ));
    }

    self.tsfn.call_with_return_value(
      Box::new(params),
      ThreadsafeFunctionCallMode::NonBlocking,
      move |JsValue(value, env)| {
        if let Some(tx) = tx {
          Self::await_promise(&env, value, tx)?;
        }
        Ok(())
      },
    );

    Ok(())
  }

  /// Unwrap promise return value. Cannot be run on the main thread
  pub fn await_promise<Response: Send + DeserializeOwned + 'static>(
    env: &Env,
    target: JsUnknown,
    tx: Sender<napi::Result<Response>>,
  ) -> napi::Result<()> {
    // If the result is a promise, wait for it to resolve, and send the result to the channel.
    // Otherwise, send the result immediately.
    if target.is_promise()? {
      let result: JsObject = target.try_into()?;
      let then: JsFunction = result.get_named_property("then")?;

      let tx2 = tx.clone();
      let cb = env.create_function_from_closure("callback", move |ctx| {
        let res = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
        tx.send(Ok(res)).expect("send failure");
        ctx.env.get_undefined()
      })?;

      let eb = env.create_function_from_closure("error_callback", move |ctx| {
        let err = napi::Error::from(ctx.get::<JsUnknown>(0)?);
        tx2.send(Err(err)).expect("send failure");
        ctx.env.get_undefined()
      })?;

      then.call(Some(&result), &[cb, eb])?;
    } else if target.is_error()? {
      let res = Err(napi::Error::from(target));
      tx.send(res).expect("send failure");
    } else {
      let res = env.from_js_value(target)?;
      tx.send(Ok(res)).expect("send failure");
    }

    Ok(())
  }
}

impl Drop for JsCallable {
  fn drop(&mut self) {
    LOCAL_FUNCTIONS.with(move |(_, map)| {
      let mut map = map.borrow_mut();
      map.remove(&self.callback);
    });
  }
}
