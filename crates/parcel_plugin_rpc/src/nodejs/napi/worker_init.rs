use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::thread;

use once_cell::sync::Lazy;

use super::RpcCallback;

enum WorkerInitMessage {
  Subscribe(Sender<RpcCallback>),
  Register(RpcCallback),
}

// Nodejs worker threads are initialized from JavaScript and cannot
// have Rust channels passed into them (without unsafe Rust).
// For this reason, WORKER_INIT acts a global mpmc broadcast channel
// that allows a listener to prepare a channel for a Nodejs worker thread
// to obtain when it has initialized.
// It's something like a cross-thread globalThis.postMessage() but in Rust
static WORKER_INIT: Lazy<Sender<WorkerInitMessage>> = Lazy::new(|| {
  let (tx_subscribe, rx_subscribe) = channel::<WorkerInitMessage>();

  thread::spawn(move || {
    let mut subscribers = Vec::<Sender<RpcCallback>>::new();
    let mut rpx_receivers = Vec::<RpcCallback>::new();

    while let Ok(msg) = rx_subscribe.recv() {
      match msg {
        WorkerInitMessage::Subscribe(subscriber) => {
          if let Some(rx_rpc) = rpx_receivers.pop() {
            subscriber.send(rx_rpc).unwrap();
          } else {
            subscribers.push(subscriber);
          }
        }
        WorkerInitMessage::Register(rx_rpc) => {
          if let Some(subscriber) = subscribers.pop() {
            subscriber.send(rx_rpc).unwrap();
          } else {
            rpx_receivers.push(rx_rpc);
          }
        }
      }
    }
  });

  tx_subscribe
});

pub fn get_worker_callback() -> RpcCallback {
  let (tx, rx) = channel();
  WORKER_INIT.send(WorkerInitMessage::Subscribe(tx)).unwrap();
  rx.recv().unwrap()
}

pub fn register_worker_callback(callback: RpcCallback) {
  WORKER_INIT
    .send(WorkerInitMessage::Register(callback))
    .unwrap();
}
