use napi::*;
use napi_derive::napi;

use crate::helpers::console_log;
use crate::helpers::create_async_callback;

use super::worker_request;
use super::worker_request::WorkerRequest;
use super::worker_response::WorkerResponse;

#[napi]
fn main_worker(env: Env, callback: JsFunction) -> napi::Result<JsUndefined> {
  // Make callback usable in threads
  let call_callback = create_async_callback::<WorkerRequest, WorkerResponse>(env, callback);
  
  env.spawn_future(async move {
    let result = call_callback(worker_request::PING).await;
    println!("Result {:?}", result);

    Ok(())
  })?;

  env.get_undefined()
}
