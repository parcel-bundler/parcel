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

use super::JsValue;

pub type JsMapInput = Box<dyn FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send>;

/// JsCallable provides a Send + Sync wrapper around callable JavaScript functions.
/// Functions can be called from threads or the main thread.
/// Parameters and return types will automatically be converted using serde.
pub struct JsCallable {
  initial_thread: ThreadId,
  tsfn: ThreadsafeFunction<JsMapInput, ErrorStrategy::Fatal>,
}

impl JsCallable {
  pub fn new(callback: JsFunction) -> napi::Result<Self> {
    let initial_thread = std::thread::current().id();

    // Store the threadsafe function on the struct
    let tsfn: ThreadsafeFunction<JsMapInput, ErrorStrategy::Fatal> = callback
      .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<JsMapInput>| {
        (ctx.value)(&ctx.env)
      })?;

    Ok(Self {
      initial_thread,
      tsfn,
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
    self.tsfn.call(
      Box::new(map_params),
      ThreadsafeFunctionCallMode::NonBlocking,
    );

    Ok(())
  }

  pub fn call_with_return<Return: Send + 'static>(
    &self,
    map_params: impl FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static,
    map_return: impl Fn(&Env, JsUnknown) -> napi::Result<Return> + Send + 'static,
  ) -> napi::Result<Return> {
    let (tx, rx) = channel();

    self.tsfn.call_with_return_value(
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
}
