use std::{
  sync::{
    Arc, Mutex,
    mpsc::{self, Receiver, Sender},
  },
  thread::{self, available_parallelism},
};

use crate::{
  AssetNodeIndex, AssetRequest, ParcelConfig, ParcelOptions,
  transformer::{TransformRequest, TransformResult},
};

pub enum Request {
  Transform(TransformRequest),
}

pub enum RequestResult {
  Transform(TransformResult),
}

pub struct TransformQueue {
  request_sender: Sender<Request>,
  result_receiver: Receiver<RequestResult>,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
  pending_requests: usize,
}

impl TransformQueue {
  pub fn new(config: Arc<ParcelConfig>, options: Arc<ParcelOptions>) -> TransformQueue {
    let (request_sender, request_receiver) = mpsc::channel::<Request>();
    let (result_sender, result_receiver) = mpsc::channel::<RequestResult>();
    spawn_workers(request_receiver, result_sender);
    TransformQueue {
      request_sender,
      result_receiver,
      pending_requests: 0,
      config,
      options,
    }
  }

  pub fn transform(&mut self, index: AssetNodeIndex, req: Arc<AssetRequest>) {
    self.pending_requests += 1;
    let request = Request::Transform(TransformRequest {
      index,
      req,
      options: self.options.clone(),
      config: self.config.clone(),
    });
    self.request_sender.send(request).unwrap();
  }

  pub fn receive(&mut self) -> Option<RequestResult> {
    if self.pending_requests > 0 {
      let result = self.result_receiver.recv().unwrap();
      self.pending_requests -= 1;
      Some(result)
    } else {
      None
    }
  }
}

fn spawn_workers(rx: mpsc::Receiver<Request>, tx: mpsc::Sender<RequestResult>) {
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

        let _ = tx.send(result);
      }
    });
  }
}
