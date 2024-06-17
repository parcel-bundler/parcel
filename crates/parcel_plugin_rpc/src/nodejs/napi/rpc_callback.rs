use std::sync::mpsc::channel;

use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::CallContext;
use napi::Env;
use napi::JsFunction;
use napi::JsUnknown;
use serde::de::DeserializeOwned;
use serde::Serialize;

pub type JsMapInput = Box<dyn FnOnce(&Env) -> napi::Result<JsUnknown> + Send>;
pub type JsMapReturn = Box<dyn Fn(&CallContext) -> napi::Result<()> + Send>;
pub type ThreadSafeInput = (String, JsMapInput, JsMapReturn);
pub type RpcResult<T> = Result<T, String>;
pub type RpcCallback = ThreadsafeFunction<ThreadSafeInput>;

pub fn create_js_callback(env: &Env, callback: JsFunction) -> napi::Result<RpcCallback> {
  env.create_threadsafe_function(
    &callback,
    0,
    |ctx: ThreadSafeCallContext<ThreadSafeInput>| -> napi::Result<Vec<JsUnknown>> {
      let id = ctx.env.create_string(&ctx.value.0)?.into_unknown();
      let message = (ctx.value.1)(&ctx.env)?;
      let callback = ctx.value.2;
      let callback = ctx
        .env
        .create_function_from_closure("callback", move |ctx| {
          callback(&ctx)?;
          ctx.env.get_undefined()
        })?
        .into_unknown();
      Ok(vec![id, message, callback])
    },
  )
}

pub fn send_with<R>(
  tsfn: &RpcCallback,
  identifier: &str,
  map_params: impl FnOnce(&Env) -> napi::Result<JsUnknown> + Send + 'static,
  map_return: impl Fn(&CallContext) -> napi::Result<RpcResult<R>> + Send + 'static,
) -> anyhow::Result<R>
where
  R: Send + 'static,
{
  let (tx, rx) = channel();

  tsfn.call(
    Ok((
      identifier.to_string(),
      Box::new(map_params),
      Box::new(move |ctx| -> napi::Result<()> {
        let result = map_return(&ctx)?;
        tx.send(result).unwrap();
        Ok(())
      }),
    )),
    ThreadsafeFunctionCallMode::NonBlocking,
  );

  rx.recv().unwrap().map_err(|e| anyhow::anyhow!("{}", e))
}

pub fn send_serde<P, R>(tsfn: &RpcCallback, identifier: &str, params: P) -> anyhow::Result<R>
where
  P: Serialize + Send + Sync + 'static,
  R: DeserializeOwned + Send + 'static,
{
  send_with(
    tsfn,
    identifier,
    move |env| Ok(env.to_js_value(&params)?.into_unknown()),
    |ctx| {
      Ok(
        ctx
          .env
          .from_js_value::<RpcResult<R>, JsUnknown>(ctx.get::<JsUnknown>(0)?)?,
      )
    },
  )
}
