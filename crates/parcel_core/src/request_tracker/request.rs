use std::collections::hash_map::DefaultHasher;
use std::fmt::Debug;
use std::hash::Hash;
use std::hash::Hasher;
use std::sync::Arc;

use dyn_hash::DynHash;

use super::RequestTracker;

pub trait Request<Res, Provide>: DynHash
where
  Res: Send + Debug + Clone,
  Provide: Send + Clone,
{
  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher);
    self.dyn_hash(&mut hasher);
    hasher.finish()
  }

  fn run(
    &self,
    ctx: Arc<RunRequestContext<Res, Provide>>,
  ) -> Result<RequestResult<Res>, Vec<RequestError>>;
}

dyn_hash::hash_trait_object!(
  <Res, Provide> Request<Res, Provide>
  where
    Res: Send + Debug + Clone,
    Provide: Send + Clone
);

pub struct RunRequestContext<Res, Provide>
where
  Res: Send + Debug + Clone,
  Provide: Send + Clone,
{
  pub request_tracker: Box<dyn RequestTracker<Res, Provide>>,
  pub parent_node: Option<u64>,
  pub provide: Provide,
}

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

#[derive(Clone, Debug)]
pub enum RequestError {}
