use std::fmt::Debug;
use std::hash::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;

use crate::plugins::Plugins;
use dyn_hash::DynHash;
use parcel_core::plugin::ReporterEvent;
use parcel_core::types::Invalidation;

use super::RequestTracker;

pub struct RunRequestContext<'a, T> {
  parent_request_hash: Option<u64>,
  request_tracker: &'a mut RequestTracker<T>,
}

impl<'a, T: Clone> RunRequestContext<'a, T> {
  pub(crate) fn new(
    parent_request_hash: Option<u64>,
    request_tracker: &'a mut RequestTracker<T>,
  ) -> Self {
    Self {
      parent_request_hash,
      request_tracker,
    }
  }

  pub fn report(&self, _event: ReporterEvent) {
    // TODO
  }

  pub fn run_request(&mut self, request: &impl Request<T>) -> anyhow::Result<T> {
    self
      .request_tracker
      .run_child_request(request, self.parent_request_hash)
  }

  pub fn get_plugins(&self) -> Plugins {
    todo!()
  }
}

// We can type this properly
pub type RunRequestError = anyhow::Error;

pub trait Request<T: Clone>: DynHash {
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
