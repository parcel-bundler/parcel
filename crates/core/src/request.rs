use std::sync::{
  Arc,
  mpsc::{self, Receiver, Sender},
};

use crate::{
  AssetNodeIndex, AssetRequest, Diagnostic, Invalidations, ParcelConfig, ParcelOptions,
  transformer::{TransformRequest, TransformResult},
};

pub enum RequestResult {
  Transform(TransformResult),
}

/// Runs transforms on rayon's global thread pool, which packaging also uses, so that a build has one
/// set of worker threads (and one set of their thread-local state, such as JS runtimes). The asset
/// graph builder receives the results on its own thread, which isn't one of the pool's.
pub struct TransformQueue {
  result_sender: Sender<RequestResult>,
  result_receiver: Receiver<RequestResult>,
  config: Arc<ParcelConfig>,
  options: Arc<ParcelOptions>,
  pending_requests: usize,
}

impl TransformQueue {
  pub fn new(config: Arc<ParcelConfig>, options: Arc<ParcelOptions>) -> TransformQueue {
    let (result_sender, result_receiver) = mpsc::channel::<RequestResult>();
    TransformQueue {
      result_sender,
      result_receiver,
      pending_requests: 0,
      config,
      options,
    }
  }

  pub fn transform(&mut self, index: AssetNodeIndex, req: Arc<AssetRequest>) {
    self.pending_requests += 1;
    let request = TransformRequest {
      index,
      req,
      options: self.options.clone(),
      config: self.config.clone(),
    };
    let sender = self.result_sender.clone();
    // Spawned from outside the pool, so tasks are queued in the order they're requested.
    rayon::spawn(move || {
      let _ = sender.send(RequestResult::Transform(run(request)));
    });
  }

  /// Whether any transform requests are still in flight.
  pub fn has_pending(&self) -> bool {
    self.pending_requests > 0
  }

  pub fn receive(&mut self) -> Option<RequestResult> {
    if self.pending_requests > 0 {
      match self.result_receiver.recv() {
        Ok(result) => {
          self.pending_requests -= 1;
          Some(result)
        }
        Err(_) => {
          // Unreachable while `self` holds a sender, but nothing more could arrive.
          self.pending_requests = 0;
          None
        }
      }
    } else {
      None
    }
  }
}

/// Runs a transform, turning a panic into an error. A panic must not escape: rayon aborts the process
/// when a spawned task panics.
fn run(request: TransformRequest) -> TransformResult {
  let index = request.index;
  let req = request.req.clone();
  match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| request.run())) {
    Ok(result) => result,
    Err(payload) => {
      let message = payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "transform panicked".to_string());
      TransformResult {
        index,
        req,
        invalidations: Invalidations::default(),
        result: Err(Diagnostic::from_message(message).into()),
      }
    }
  }
}
