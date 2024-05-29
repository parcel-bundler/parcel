use std::thread;

use napi::Env;
use napi::JsFunction;
use napi::JsUndefined;

use super::parcel;

#[napi_derive::napi]
fn controller_main_subscribe(env: Env, _callback: JsFunction) -> napi::Result<JsUndefined> {
  // TODO tsfn, channels & all that good stuff

  // This must run in a separate thread
  thread::spawn(move || parcel::parcel_main());

  env.get_undefined()
}
