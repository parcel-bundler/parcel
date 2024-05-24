use std::collections::hash_map::DefaultHasher;
use std::fmt::Debug;
use std::hash::Hash;
use std::hash::Hasher;

use dyn_hash::DynHash;

use super::request_graph::RequestError;
use super::RequestTracker;

pub trait Request<Res: Send + Debug, Provide>: DynHash + Sync {
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(
    &self,
    request_tracker: Box<dyn RequestTracker<Res, Provide>>,
    provided: Provide,
  ) -> Result<RequestResult<Res>, Vec<RequestError>>;
}

dyn_hash::hash_trait_object!(<R, P> Request<R, P> where R: Send + Debug);

#[derive(Clone, Debug)]
pub struct RequestResult<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Clone, Debug)]
pub enum Invalidation {}
