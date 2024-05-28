use std::fmt::Debug;
use std::hash::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;

use dyn_hash::DynHash;

use super::RequestTracker;

pub trait Request<T: Clone>: DynHash {
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(&self, request_tracker: RequestTracker<T>) -> Result<RequestResult<T>, Vec<RequestError>>;
}

dyn_hash::hash_trait_object!(<T: Clone> Request<T>);

pub struct RequestResult<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Debug, Clone)]
pub enum RequestError {
  Impossible,
}

#[derive(Debug)]
pub enum Invalidation {}
