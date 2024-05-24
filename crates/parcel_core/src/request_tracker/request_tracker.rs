use std::fmt::Debug;

use dyn_clone::DynClone;

use super::request_graph::RequestError;
use super::Request;
use super::RequestResult;

pub trait RequestTracker<Res: Send + Debug + Clone + 'static, Provide: Clone + 'static>:
  DynClone
{
  fn run_request(
    &self,
    request: Box<dyn Request<Res, Provide>>,
  ) -> Result<RequestResult<Res>, Vec<RequestError>>;
  // fn run_requests(&self, requests: &[Box<dyn Request<Req>>]) -> Vec<Result<RequestResult<Req>, Vec<RequestError>>>;
}

dyn_clone::clone_trait_object!(<R, P> RequestTracker<R, P> where R: Send + Debug + Clone);

// struct RequestTrackerContext<Provide: Clone> {
//   parent_node: Option<u64>,
//   provide: Provide,
// }
