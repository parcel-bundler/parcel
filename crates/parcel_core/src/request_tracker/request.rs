use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;

use super::request_graph::RequestError;

pub trait Request<D>: Hash + Sync {
  type Output: Send + Clone;

  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::new();
    std::any::type_name::<Self>().hash(&mut hasher); // ???
    self.hash(&mut hasher);
    hasher.finish()
  }

  fn run(&self, dependencies: D) -> RequestResult<Self::Output>;
}

pub trait StoreRequestOutput<T, D>: Request<D> {
  fn store(output: Self::Output) -> T;
  fn retrieve(output: &T) -> &Self::Output;
}

pub struct RequestResult<Output> {
  pub result: Result<Output, RequestError>,
  pub invalidations: Vec<Invalidation>,
}

pub enum Invalidation {}
