use std::{
  sync::mpsc::{channel, Sender},
  thread,
};

use once_cell::sync::Lazy;

use super::RpcConnectionNodejs;

enum WorkerInitMessage {
  Subscribe(Sender<RpcConnectionNodejs>),
  Register(RpcConnectionNodejs),
}

static WORKER_INIT: Lazy<Sender<WorkerInitMessage>> = Lazy::new(|| {
  let (tx_subscribe, rx_subscribe) = channel::<WorkerInitMessage>();

  thread::spawn(move || {
    let mut subscribers = Vec::<Sender<RpcConnectionNodejs>>::new();
    let mut workers = Vec::<RpcConnectionNodejs>::new();

    while let Ok(msg) = rx_subscribe.recv() {
      match msg {
        WorkerInitMessage::Subscribe(subscriber) => {
          if let Some(rx_rpc) = workers.pop() {
            subscriber.send(rx_rpc).unwrap();
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

pub fn get_worker() -> RpcConnectionNodejs {
  let (tx, rx) = channel();
  WORKER_INIT.send(WorkerInitMessage::Subscribe(tx)).unwrap();
  rx.recv().unwrap()
}

pub fn register_worker(worker: RpcConnectionNodejs) {
  WORKER_INIT
    .send(WorkerInitMessage::Register(worker))
    .unwrap();
}
