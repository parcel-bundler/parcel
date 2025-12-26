use std::{
  sync::{Arc, Mutex, mpsc},
  thread::{self, available_parallelism},
};

use crate::{
  Diagnostic,
  transformer::{TransformRequest, TransformResult},
};

pub enum Request {
  Transform(TransformRequest),
}

pub enum RequestResult {
  Transform(Result<TransformResult, Vec<Diagnostic>>),
}

pub fn spawn_workers(rx: mpsc::Receiver<Request>, tx: mpsc::Sender<RequestResult>) {
  // To multiplex the non-cloneable Receiver, wrap it in Arc<Mutex<_>>.
  let rx = Arc::new(Mutex::new(rx));

  for _ in 0..available_parallelism().unwrap().get() {
    let tx = tx.clone();
    let rx = Arc::clone(&rx);
    thread::spawn(move || {
      loop {
        let request: Result<_, _> = {
          let receiver_guard = rx.lock().unwrap();
          receiver_guard.recv()
        };

        let Ok(request) = request else {
          // The sender got dropped. No more commands coming in.
          break;
        };

        let result = match request {
          Request::Transform(req) => RequestResult::Transform(req.run()),
        };

        tx.send(result).unwrap();
      }
    });
  }
}
