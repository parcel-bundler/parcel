use dyn_hash::DynHash;
use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::fmt::Debug;

use super::request_graph::RequestError;
use super::RequestTracker;

pub trait Request<Res: Send + Debug>: DynHash + Sync {
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(
    &self,
    request_tracker: Box<dyn RequestTracker<Res>>,
  ) -> Result<RequestResult<Res>, Vec<RequestError>>;
}

dyn_hash::hash_trait_object!(<R> Request<R> where R: Send + Debug);

#[derive(Clone, Debug)]
pub struct RequestResult<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Clone, Debug)]
pub enum Invalidation {}
