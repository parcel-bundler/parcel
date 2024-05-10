use std::future::Future;
use std::pin::Pin;

use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi::*;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::sync::mpsc::unbounded_channel;
use tokio::sync::mpsc::UnboundedSender;

use super::console_log;

pub fn create_async_callback<Input, Output>(env: Env, callback: JsFunction) -> impl FnOnce(Input) -> Pin<Box<dyn Future<Output = Output> + Send>> 
  where 
    Input: Serialize + Send + 'static,
    Output: DeserializeOwned + Send + 'static {
  let tsfn = env.create_threadsafe_function(
    &callback, 
    0,
    |ctx: ThreadSafeCallContext<Input>| {
      // Return value is serialized
      let value = ctx.env.to_js_value(&ctx.value);
      Ok(vec![value])
    },
  ).unwrap();

  let unsafe_env = env.raw() as usize;

  move |v: Input| Box::pin(async move {
    let (tx, mut rx) = unbounded_channel::<Output>();

    tsfn.call_with_return_value(
      Ok(v),
      ThreadsafeFunctionCallMode::Blocking,
      move |result: JsUnknown| {
        let env = unsafe { Env::from_raw(unsafe_env as _) };
        await_promise(env, result, tx)?;
        Ok(())
      },
    );

    rx.recv().await.unwrap()
  })
}

fn await_promise<T>(
  env: Env,
  result: JsUnknown,
  tx: UnboundedSender<T>,
) -> napi::Result<()> where T: DeserializeOwned + Send + 'static {
  if !result.is_promise()? {
    let res = env.from_js_value(result)?;
    tx.send(res).expect("send failure");
    return Ok(())
  }

  let result: JsObject = result.try_into()?;
  let then: JsFunction = result.get_named_property("then")?;

  let cb = env.create_function_from_closure("callback", move |ctx| {
    let v = ctx.get::<JsUnknown>(0)?;
    let res = ctx.env.from_js_value(v).expect("msg");
    tx.send(res).expect("send failure");
    ctx.env.get_undefined()
  })?;

  let eb = env.create_function_from_closure("error_callback", move |ctx| {
    let err = ctx.env.from_js_value(ctx.get::<JsUnknown>(0)?)?;
    println!("Failed {:?}", err);
    ctx.env.get_undefined()
  })?;
  
  then.call(Some(&result), &[cb, eb])?;
  Ok(())
}
