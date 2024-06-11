use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::Env;
use napi::JsFunction;
use napi::JsUnknown;

use crate::RpcConnectionRef;
use crate::RpcHost;
use crate::RpcHostMessage;

use super::napi::create_callback;
use super::napi::wrap_threadsafe_function;
use super::RpcConnectionNodejs;
use super::RpcConnectionsNodejs;

pub struct RpcHostNodejs {
  tx_rpc: Sender<RpcHostMessage>,
  node_workers: u32,
}

impl RpcHostNodejs {
  pub fn new(env: &Env, callback: JsFunction, node_workers: u32) -> napi::Result<Self> {
    // Create a threadsafe function that casts the incoming message data to something
    // accessible in JavaScript. The function accepts a return value from a JS callback
    let mut threadsafe_function: ThreadsafeFunction<RpcHostMessage> = env
      .create_threadsafe_function(
        &callback,
        0,
        |ctx: ThreadSafeCallContext<RpcHostMessage>| {
          let id = ctx.env.create_uint32(ctx.value.get_id())?.into_unknown();
          let (message, callback) = Self::map_rpc_message(&ctx.env, ctx.value)?;
          Ok(vec![id, message, callback])
        },
      )?;

    // Don't prevent Nodejs from shutting down
    threadsafe_function.unref(&env)?;

    // Forward RPC events to the threadsafe function
    let (tx_rpc, rx_rpc) = channel();
    wrap_threadsafe_function(threadsafe_function, rx_rpc);

    Ok(Self {
      node_workers,
      tx_rpc,
    })
  }

  // Map the RPC message to a JavaScript type
  fn map_rpc_message(env: &Env, msg: RpcHostMessage) -> napi::Result<(JsUnknown, JsUnknown)> {
    Ok(match msg {
      RpcHostMessage::Ping { response: reply } => {
        let message = env.to_js_value(&())?;
        let callback = create_callback(&env, reply)?;
        (message, callback)
      }
      RpcHostMessage::Start { response: _ } => {
        unreachable!()
      }
    })
  }
}

// Forward events to Nodejs
impl RpcHost for RpcHostNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    let (tx, rx) = channel();
    self.tx_rpc.send(RpcHostMessage::Ping { response: tx })?;
    Ok(rx.recv()?.map_err(|e| anyhow::anyhow!(e))?)
  }

  fn start(&self) -> anyhow::Result<RpcConnectionRef> {
    // JavaScript workers will have already been created
    // This waits for the workers to connect
    let mut connections = vec![];
    for _ in 0..self.node_workers {
      connections.push(RpcConnectionNodejs::new())
    }

    Ok(Arc::new(RpcConnectionsNodejs::new(connections)))
  }
}
