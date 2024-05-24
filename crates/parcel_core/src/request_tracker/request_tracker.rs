use std::fmt::Debug;

use super::{request_graph::RequestError, Request, RequestResult};

pub trait RequestTracker<Req: Send + Debug> {
  fn run_request(&mut self, request: Box<dyn Request<Req>>) -> Result<RequestResult<Req>, Vec<RequestError>>;
  // fn run_requests(&self, requests: &[Box<dyn Request<Req>>]) -> Vec<Result<RequestResult<Req>, Vec<RequestError>>>;
}
