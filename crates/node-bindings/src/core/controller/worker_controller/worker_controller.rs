use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::thread;

use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUndefined;
use napi::JsUnknown;

use super::request::ControllerMessagePingRequest;
use super::request::WorkerControllerMessageRequest;
use super::response::WorkerControllerMessageResponse;

#[napi_derive::napi]
fn parcel_controller_worker(env: Env, callback: JsFunction) -> napi::Result<JsUndefined> {
  let (tx, rx) = channel::<(
    WorkerControllerMessageRequest,
    Sender<WorkerControllerMessageResponse>,
  )>();

  let tsfn = env
    .create_threadsafe_function(
      &callback,
      0,
      |ctx: ThreadSafeCallContext<WorkerControllerMessageRequest>| {
        // Return value is serialized
        let value = ctx.env.to_js_value(&ctx.value);
        Ok(vec![value])
      },
    )
    .unwrap();

  // Pedro don't look
  let unsafe_env = env.raw() as usize;

  thread::spawn(move || {
    while let Ok((request, tx_response)) = rx.recv() {
      tsfn.call_with_return_value(
        Ok(request),
        ThreadsafeFunctionCallMode::Blocking,
        move |result: JsUnknown| {
          // This is actually safe because this closure runs on the JavaScript thread
          let env = unsafe { Env::from_raw(unsafe_env as napi::sys::napi_env) };

          if !result.is_promise()? {
            let js_value =
              env.from_js_value::<WorkerControllerMessageResponse, JsUnknown>(result)?;

            tx_response.send(js_value).unwrap();
            return Ok(());
          }

          let result: JsObject = result.try_into()?;
          let then: JsFunction = result.get_named_property("then")?;

          let cb = env.create_function_from_closure("callback", {
            let tx_response = tx_response.clone();

            move |ctx| {
              let v = ctx.get::<JsUnknown>(0)?;
              let casted = env.from_js_value::<WorkerControllerMessageResponse, JsUnknown>(v)?;
              tx_response.send(casted).unwrap();
              ctx.env.get_undefined()
            }
          })?;

          then.call(Some(&result), &[cb])?;

          Ok(())
        },
      );
    }
  });

  thread::spawn(move || {
    // let (tx_response, rx_response) = channel();

    // tx.send((
    //   WorkerControllerMessageRequest::Ping(ControllerMessagePingRequest {}),
    //   tx_response,
    // ))
    // .unwrap();

    // println!("{:?}", rx_response.recv());
  });

  env.get_undefined()
}
