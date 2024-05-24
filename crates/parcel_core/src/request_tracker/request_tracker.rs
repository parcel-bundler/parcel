use std::fmt::Debug;
use std::sync::Arc;

use dyn_clone::DynClone;

use super::Request;
use super::RequestError;
use super::RequestResult;
use super::RunRequestContext;

pub trait RequestTracker<Res, Provide>: DynClone
where
  Res: Send + Debug + Clone,
  Provide: Send + Clone,
{
  fn run_request(
    &self,
    parent_ctx: Option<Arc<RunRequestContext<Res, Provide>>>,
    request: Arc<dyn Request<Res, Provide>>,
  ) -> Result<RequestResult<Res>, Vec<RequestError>>;
}

dyn_clone::clone_trait_object!(
  <Res, Provide> RequestTracker<Res, Provide>
  where
    Res: Send + Debug + Clone,
    Provide: Send + Clone
);
