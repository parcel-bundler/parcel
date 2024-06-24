use std::fmt::Debug;
use std::hash::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::sync::Arc;

use dyn_hash::DynHash;
use parcel_core::plugin::ReporterEvent;
use parcel_core::types::Invalidation;

use super::RequestQueue;
use super::RequestTracker;

pub struct RunRequestContext<T> {
  parent_request_hash: Option<u64>,
  request_tracker: Arc<RequestTracker<T>>,
}

impl<T: Clone + Send> RunRequestContext<T> {
  pub(crate) fn new(
    parent_request_hash: Option<u64>,
    request_tracker: Arc<RequestTracker<T>>,
  ) -> Self {
    Self {
      parent_request_hash,
      request_tracker,
    }
  }

  pub fn report(&self, _event: ReporterEvent) {
    // TODO
  }

  pub fn start_request_queue<'scope>(&mut self, handler: FnOnce(&mut RequestQueue<'_, 'scope, T>)) {
    rayon::in_place_scope(|scope| {
      handler(&mut RequestQueue::new(
        scope,
        self.request_tracker.clone(),
        self.parent_request_hash,
      ));
    })
  }

  pub fn run_request(&mut self, request: &impl Request<T>) -> anyhow::Result<T> {
    self
      .request_tracker
      // .lock()
      // .map_err(|_| anyhow::anyhow!("Failed to acquire request tracker lock"))?
      .run_child_request(request, self.parent_request_hash)
  }
}

// We can type this properly
pub type RunRequestError = anyhow::Error;

pub trait Request<T: Clone + Send>: DynHash {
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(&self, request_context: RunRequestContext<T>)
    -> Result<RequestResult<T>, RunRequestError>;
}

dyn_hash::hash_trait_object!(<T: Clone> Request<T>);

#[derive(Debug, PartialEq)]
pub struct RequestResult<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Debug, Clone)]
pub enum RequestError {
  Impossible,
}
