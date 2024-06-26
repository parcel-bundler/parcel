use std::sync::mpsc::{channel, Receiver};

use napi::{Env, JsObject, JsUndefined};
use napi_derive::napi;
use once_cell::sync::Lazy;
use parking_lot::Mutex;

#[napi]
pub fn register_worker(env: Env, worker: JsObject) -> napi::Result<JsUndefined> {
  env.get_undefined()
}
