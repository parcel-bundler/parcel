use napi::Env;
use napi::JsFunction;
use napi::JsUndefined;

#[napi_derive::napi]
pub fn main_bootstrap(env: Env, _callback: JsFunction) -> napi::Result<JsUndefined> {
  // TODO
  //  tsfn + channels to handle sending messages to/from JavaScript
  //  main thread will bootstrap workers

  env.get_undefined()
}
