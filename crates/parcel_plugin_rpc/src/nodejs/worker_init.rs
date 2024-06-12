use std::sync::mpsc::channel;
use std::sync::mpsc::Receiver;
use std::sync::mpsc::Sender;
use std::thread;

use once_cell::sync::Lazy;

use crate::RpcConnectionMessage;

enum WorkerInitMessage {
  Subscribe(Sender<Sender<RpcConnectionMessage>>),
  Register(Sender<RpcConnectionMessage>),
}

// Nodejs worker threads are initialized from JavaScript and cannot
// have channels passed into them as that requires creating a channel in Rust,
// passing that to the main JavaScript thread, passes them to the Js workers
// then back into Rust. For this reason, WORKER_INIT acts a global mpmc broadcast channel
// that allows Nodejs worker threads to notify a listener that they are ready to be used.
// It's something like a cross-thread globalThis.postMessage() but in Rust
static WORKER_INIT: Lazy<Sender<WorkerInitMessage>> = Lazy::new(|| {
  let (tx_subscribe, rx_subscribe) = channel::<WorkerInitMessage>();

  thread::spawn(move || {
    let mut subscribers = Vec::<Sender<Sender<RpcConnectionMessage>>>::new();
    let mut workers = Vec::<Sender<RpcConnectionMessage>>::new();

    while let Ok(msg) = rx_subscribe.recv() {
      match msg {
        WorkerInitMessage::Subscribe(subscriber) => {
          if let Some(worker) = workers.pop() {
            subscriber.send(worker).unwrap();
          } else {
            subscribers.push(subscriber);
          }
        }
        WorkerInitMessage::Register(worker) => {
          if let Some(subscriber) = subscribers.pop() {
            subscriber.send(worker).unwrap();
          } else {
            workers.push(worker);
          }
        }
      }
    }
  });

  tx_subscribe
});

pub fn on_worker_loaded() -> Sender<RpcConnectionMessage> {
  let (tx_rpc_subscribe, rx_rpc_subscribe) = channel();
  WORKER_INIT
    .send(WorkerInitMessage::Subscribe(tx_rpc_subscribe))
    .unwrap();
  rx_rpc_subscribe.recv().unwrap()
}

pub fn notify_worker_loaded() -> Receiver<RpcConnectionMessage> {
  let (tx_rpc, rx_rpc) = channel();
  WORKER_INIT
    .send(WorkerInitMessage::Register(tx_rpc))
    .unwrap();
  rx_rpc
}
