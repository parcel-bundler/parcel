use std::sync::mpsc::Sender;

use napi::Env;
use napi::JsUnknown;
use serde::de::DeserializeOwned;

// Generic method to create a "resolve" javascript function to
// return the value from the thread safe function
pub fn create_done_callback<Returns: DeserializeOwned + 'static>(
  env: &Env,
  reply: Sender<Returns>,
) -> napi::Result<JsUnknown> {
  let callback = env
    .create_function_from_closure("callback", move |ctx| {
      let response = ctx
        .env
        .from_js_value::<Returns, JsUnknown>(ctx.get::<JsUnknown>(0)?)?;

      if reply.send(response).is_err() {
        return Err(napi::Error::from_reason("Unable to send rpc response"));
      }

      ctx.env.get_undefined()
    })?
    .into_unknown();

  Ok(callback)
}
