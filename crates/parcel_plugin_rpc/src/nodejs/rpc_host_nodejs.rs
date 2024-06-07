use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::thread;

use anyhow::anyhow;
use napi;
use napi::threadsafe_function::ThreadSafeCallContext;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsUnknown;
use napi::Status;
use serde::de::DeserializeOwned;

use crate::RpcHost;
use crate::RpcHostMessage;

pub struct RpcHostNodejs {
  tx_rpc: Sender<RpcHostMessage>,
}

impl RpcHostNodejs {
  pub fn new(env: &Env, callback: JsFunction) -> napi::Result<Self> {
    // Create a threadsafe function that casts the incoming message data to
    // something accessible in JavaScript. The function accepts from a JS callback
    let threadsafe_function: ThreadsafeFunction<RpcHostMessage> = env.create_threadsafe_function(
      &callback,
      0,
      |ctx: ThreadSafeCallContext<RpcHostMessage>| {
        let id = Self::get_message_id(&ctx.value);
        match ctx.value {
          RpcHostMessage::Ping { response: reply } => {
            let callback = Self::create_callback(&ctx.env, reply)?;
            let id = ctx.env.create_uint32(id)?.into_unknown();
            let message = ctx.env.to_js_value(&())?;
            Ok(vec![id, message, callback])
          }
        }
      },
    )?;

    // Forward RPC events to the threadsafe function from a new thread
    let (tx_rpc, rx_rpc) = channel();
    thread::spawn(move || {
      while let Ok(msg) = rx_rpc.recv() {
        if !matches!(
          threadsafe_function.call(Ok(msg), ThreadsafeFunctionCallMode::NonBlocking),
          Status::Ok
        ) {
          return;
        };
      }
    });

    Ok(Self { tx_rpc })
  }

  // Generic method to create a "resolve" javascript function to
  // return the value from the thread safe function
  fn create_callback<Returns: DeserializeOwned + 'static>(
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

  // Map the RPC messages to numerical values to make matching
  // easier from within JavaScript
  fn get_message_id(message: &RpcHostMessage) -> u32 {
    match message {
      RpcHostMessage::Ping { response: _ } => 0,
    }
  }
}

// Forward events to Nodejs
impl RpcHost for RpcHostNodejs {
  fn ping(&self) -> anyhow::Result<()> {
    let (tx, rx) = channel();
    self.tx_rpc.send(RpcHostMessage::Ping { response: tx })?;
    Ok(rx.recv()?.map_err(|e| anyhow!(e))?)
  }
}
