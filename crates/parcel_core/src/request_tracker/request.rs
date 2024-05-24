use std::collections::hash_map::DefaultHasher;
use std::fmt::write;
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

#[derive(Clone)]
pub struct RequestResult<Req> {
  pub result: Req,
  pub invalidations: Vec<Invalidation>,
}

impl<Req: Debug> Debug for RequestResult<Req> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let mut output = format!("RequestResult({:?}", &self.result);

    if self.invalidations.len() == 0 {
      output += ")";
    } else {
      output += &format!(", {:?})", &self.invalidations);
    }

    write!(f, "{}", output)
  }
}

#[derive(Clone, Debug)]
pub enum Invalidation {}
