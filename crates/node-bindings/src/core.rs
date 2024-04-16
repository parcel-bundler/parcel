use std::sync::Arc;

use crossbeam_channel::{Receiver, Sender};
use napi::{
  threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunctionCallMode},
  Env, JsFunction, JsObject, JsUnknown,
};
use napi_derive::napi;
use parcel_core::worker_farm::WorkerCallback;
use parcel_core::{
  asset_graph::AssetGraphRequest,
  request_tracker::RequestTracker,
  worker_farm::{WorkerError, WorkerFarm, WorkerRequest, WorkerResult},
};

// Allocate a single channel per thread to communicate with the JS thread.
thread_local! {
  static CHANNEL: (Sender<Result<WorkerResult, WorkerError>>, Receiver<Result<WorkerResult, WorkerError>>) = crossbeam_channel::unbounded();
}

/// Creates a macro callback from a JS function.
fn create_worker_callback(function: JsFunction, env: Env) -> napi::Result<WorkerCallback> {
  let tsfn =
    env.create_threadsafe_function(&function, 0, |ctx: ThreadSafeCallContext<WorkerRequest>| {
      let value = ctx.env.to_js_value(&ctx.value);
      Ok(vec![value])
    })?;

  // Get around Env not being Send. See safety note below.
  let unsafe_env = env.raw() as usize;

  Ok(Arc::new(move |request| {
    CHANNEL.with(|channel| {
      // Call JS function to run the macro.
      let tx = channel.0.clone();
      tsfn.call_with_return_value(
        Ok(request),
        ThreadsafeFunctionCallMode::Blocking,
        move |v: JsUnknown| {
          // When the JS function returns, await the promise, and send the result
          // through the channel back to the native thread.
          // SAFETY: this function is called from the JS thread.
          await_promise(unsafe { Env::from_raw(unsafe_env as _) }, v, tx)?;
          Ok(())
        },
      );
      // Lock the transformer thread until the JS thread returns a result.
      channel.1.recv().expect("receive failure")
    })
  }))
}

fn await_promise(
  env: Env,
  result: JsUnknown,
  tx: Sender<Result<WorkerResult, WorkerError>>,
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
      let err = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
      tx2.send(Err(err)).expect("send failure");
      ctx.env.get_undefined()
    })?;
    then.call(Some(&result), &[cb, eb])?;
  } else {
    let res = env.from_js_value(result)?;
    tx.send(Ok(res)).expect("send failure");
  }

  Ok(())
}

#[napi]
pub fn parcel(entries: Vec<String>, callback: JsFunction, env: Env) -> napi::Result<JsObject> {
  let mut farm = WorkerFarm::new();
  farm.register_worker(create_worker_callback(callback, env)?);

  let (deferred, promise) = env.create_deferred()?;

  rayon::spawn(move || {
    let mut req = AssetGraphRequest { entries };

    let mut request_tracker = RequestTracker::new(farm);
    req.build(&mut request_tracker);

    deferred.resolve(move |env| env.get_undefined());
  });

  Ok(promise)
}
