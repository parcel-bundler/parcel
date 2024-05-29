use napi::Env;
use napi::JsFunction;
use napi::JsUndefined;

#[napi_derive::napi]
fn worker_bootstrap(env: Env, _callback: JsFunction) -> napi::Result<JsUndefined> {
  // TODO tsfn + channels to handle proxying calls to plugins in Nodejs

  env.get_undefined()
}
