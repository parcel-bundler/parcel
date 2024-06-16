use crossbeam_channel::Sender;
use napi::{
  threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
  Env, JsFunction, JsObject, JsUnknown, Ref,
};
use serde::{de::DeserializeOwned, Serialize};
use std::{path::PathBuf, thread::ThreadId};

pub struct FunctionRef {
  thread_id: ThreadId,
  env: Env,
  reference: Ref<()>,
}

// SAFETY: we assert that the value is called from the JS thread below.
unsafe impl Send for FunctionRef {}
unsafe impl Sync for FunctionRef {}

impl FunctionRef {
  pub fn new(env: Env, f: JsFunction) -> napi::Result<Self> {
    Ok(Self {
      thread_id: std::thread::current().id(),
      env,
      reference: env.create_reference(f)?,
    })
  }

  pub fn env(&self) -> &Env {
    assert_eq!(
      std::thread::current().id(),
      self.thread_id,
      "Must be called on the JS thread"
    );
    &self.env
  }

  pub fn get(&self) -> napi::Result<JsFunction> {
    assert_eq!(
      std::thread::current().id(),
      self.thread_id,
      "Must be called on the JS thread"
    );
    self.env.get_reference_value(&self.reference)
  }
}

impl Drop for FunctionRef {
  fn drop(&mut self) {
    drop(self.reference.unref(self.env))
  }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct Buffer(#[serde(with = "serde_bytes")] pub Vec<u8>);

pub fn create_js_thread_safe_method<
  Params: Send + JsArgs + 'static,
  Response: Send + DeserializeOwned + 'static,
>(
  env: &Env,
  obj: &JsObject,
  method_name: &str,
) -> napi::Result<impl Fn(Params) -> napi::Result<Response>> {
  let jsfn = get_bound_function(obj, method_name)?;
  let js_fn_ref = FunctionRef::new(*env, get_bound_function(obj, method_name)?)?;

  let threadsafe_function: ThreadsafeFunction<Params, ErrorStrategy::Fatal> = jsfn
    .create_threadsafe_function(
      0,
      |ctx: napi::threadsafe_function::ThreadSafeCallContext<Params>| {
        ctx.value.to_js_args(&ctx.env)
      },
    )?;

  let tid = std::thread::current().id();

  let result = move |params: Params| {
    let env = js_fn_ref.env;
    if std::thread::current().id() == tid {
      let jsfn = js_fn_ref.get()?;
      let result = jsfn.call(None, params.to_js_args(&env)?.as_ref())?;
      if result.is_promise()? {
        println!("PROMISE");
      }
      return env.from_js_value(result);
    }

    let (tx, rx) = crossbeam_channel::bounded(1);
    threadsafe_function.call_with_return_value(
      params,
      ThreadsafeFunctionCallMode::Blocking,
      move |result: JsUnknown| await_promise(env, result, tx),
    );
    rx.recv().unwrap()
  };

  Ok(result)
}

fn get_bound_function(obj: &JsObject, method_name: &str) -> napi::Result<JsFunction> {
  let jsfn: JsFunction = obj.get_named_property(method_name)?;
  let fn_obj = jsfn.coerce_to_object()?;
  let bind: JsFunction = fn_obj.get_named_property("bind")?;
  let jsfn: JsFunction = bind.call(Some(&fn_obj), &[obj])?.try_into()?;
  Ok(jsfn)
}

fn await_promise<Response: Send + DeserializeOwned + 'static>(
  env: Env,
  result: JsUnknown,
  tx: Sender<napi::Result<Response>>,
) -> napi::Result<()> {
  // If the result is a promise, wait for it to resolve, and send the result to the channel.
  // Otherwise, send the result immediately.
  if result.is_promise()? {
    let result: JsObject = result.try_into()?;
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
  } else if result.is_error()? {
    let res = Err(napi::Error::from(result));
    tx.send(res).expect("send failure");
  } else {
    let res = env.from_js_value(result)?;
    tx.send(Ok(res)).expect("send failure");
  }

  Ok(())
}

pub trait JsArgs: Serialize {
  fn to_js_args(&self, env: &Env) -> napi::Result<Vec<JsUnknown>> {
    Ok(vec![env.to_js_value(&self)?])
  }
}

impl<A: Serialize, B: Serialize> JsArgs for (A, B) {
  fn to_js_args(&self, env: &Env) -> napi::Result<Vec<JsUnknown>> {
    Ok(vec![env.to_js_value(&self.0)?, env.to_js_value(&self.1)?])
  }
}

impl JsArgs for String {}
impl JsArgs for PathBuf {}
impl JsArgs for bool {}
