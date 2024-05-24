use std::fmt::Debug;

use dyn_clone::DynClone;

use super::{request_graph::RequestError, Request, RequestResult};

pub trait RequestTracker<Res: Send + Debug + Clone>: DynClone {
  fn run_request(&self, request: Box<dyn Request<Res>>) -> Result<RequestResult<Res>, Vec<RequestError>>;
  // fn run_requests(&self, requests: &[Box<dyn Request<Req>>]) -> Vec<Result<RequestResult<Req>, Vec<RequestError>>>;
}

dyn_clone::clone_trait_object!(<R> RequestTracker<R> where R: Send + Debug + Clone);
