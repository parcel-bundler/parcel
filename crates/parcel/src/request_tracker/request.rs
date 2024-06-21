use std::fmt::Debug;
use std::hash::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;

use dyn_hash::DynHash;
use parcel_core::cache::CacheRef;

use crate::plugins::PluginsRef;
use parcel_core::plugin::ReporterEvent;
use parcel_core::types::Invalidation;
use parcel_filesystem::FileSystemRef;

use super::RequestTracker;

/// This is the API for requests to call back onto the `RequestTracker`.
///
/// We want to avoid exposing internals of the request tracker to the implementations so that we
/// can change this.
pub struct RunRequestContext<'a, T> {
  parent_request_hash: Option<u64>,
  request_tracker: &'a mut RequestTracker<T>,
  cache: CacheRef,
  file_system: FileSystemRef,
}

impl<'a, T: Clone> RunRequestContext<'a, T> {
  pub(crate) fn new(
    parent_request_hash: Option<u64>,
    request_tracker: &'a mut RequestTracker<T>,
    cache: CacheRef,
    file_system: FileSystemRef,
  ) -> Self {
    Self {
      parent_request_hash,
      request_tracker,
      cache,
      file_system,
    }
  }

  /// Report an event.
  pub fn report(&self, event: ReporterEvent) {
    self.request_tracker.report(event);
  }

  /// Run a child request to the current request.
  #[allow(unused)]
  pub fn run_request(&mut self, request: &impl Request<T>) -> anyhow::Result<T> {
    self
      .request_tracker
      .run_child_request(request, self.parent_request_hash)
  }

  pub fn file_system(&self) -> &FileSystemRef {
    &self.file_system
  }

  pub fn plugins(&self) -> &PluginsRef {
    todo!("I don't know how to get this")
  }

  pub fn cache(&self) -> &CacheRef {
    &self.cache
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
