use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;

use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::Env;
use napi::JsFunction;
use napi::JsUnknown;

use super::napi::create_callback;
use super::napi::wrap_threadsafe_function;
use super::worker_init::notify_worker_loaded;
use super::worker_init::on_worker_loaded;

use crate::RpcConnection;
use crate::RpcConnectionMessage;

/// RpcConnectionNodejs wraps the communication with a
/// single Nodejs worker thread
pub struct RpcConnectionNodejs {
  tx_rpc: Sender<RpcConnectionMessage>,
}

impl RpcConnectionNodejs {
  pub fn new() -> Self {
    Self {
      tx_rpc: on_worker_loaded(),
    }
  }

  pub fn create_worker_callback(env: &Env, callback: JsFunction) -> napi::Result<()> {
    // This is a reference to the worker thread callback.
    // WARN: Holding a reference to this callback tells Nodejs that a long lived
    // async action is occurring which will force the Nodejs process to remain open.
    // You can "unref" a callback only on the main thread to tell Nodejs that it's okay to close,
    // however threadsafe functions obtained from worker threads cannot be unrefed
    // (otherwise the worker will exit immediately).
    // For this reason, the worker threads need to be closed manually in JavaScript by the caller
    let threadsafe_function: ThreadsafeFunction<RpcConnectionMessage> = env
      .create_threadsafe_function(
        &callback,
        0,
        |ctx: ThreadSafeCallContext<RpcConnectionMessage>| {
          let id = ctx.env.create_uint32(ctx.value.get_id())?.into_unknown();
          let (message, callback) = Self::map_rpc_message(&ctx.env, ctx.value)?;
          Ok(vec![id, message, callback])
        },
      )?;

    let rx_rpc = notify_worker_loaded();
    wrap_threadsafe_function(threadsafe_function, rx_rpc);

    Ok(())
  }

  // Map the RPC message to a JavaScript type
  fn map_rpc_message(env: &Env, msg: RpcConnectionMessage) -> napi::Result<(JsUnknown, JsUnknown)> {
    Ok(match msg {
      RpcConnectionMessage::Ping { response: reply } => {
        let message = env.to_js_value(&())?;
        let callback = create_callback(&env, reply)?;
        (message, callback)
      }
    })
  }
}

impl RpcConnection for RpcConnectionNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    let (tx, rx) = channel();
    self
      .tx_rpc
      .send(RpcConnectionMessage::Ping { response: tx })?;
    Ok(rx.recv()?.map_err(|e| anyhow::anyhow!(e))?)
  }
}
