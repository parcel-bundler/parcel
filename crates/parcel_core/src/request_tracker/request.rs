use dyn_hash::DynHash;
use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::sync::Arc;

use super::request_graph::RequestError;
use super::RequestTracker;

pub trait Request<Req: Send>: DynHash + Sync {
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(
    &self,
    request_tracker: Arc<dyn RequestTracker<Req>>,
  ) -> Result<RequestResult<Req>, Vec<RequestError>>;
}

dyn_hash::hash_trait_object!(<R> Request<R> where R: Send);

pub struct RequestResult<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

pub enum Invalidation {}
