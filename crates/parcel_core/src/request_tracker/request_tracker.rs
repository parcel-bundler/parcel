use std::fmt::Debug;

use super::{request_graph::RequestError, Request};

pub trait RequestTracker<Req: Send + Debug> {
  fn run_request(&self, request: Box<dyn Request<Req>>) -> Result<Req, Vec<RequestError>>;
  fn run_requests(&self, r: &[Box<dyn Request<Req>>]) -> Vec<Result<Req, Vec<RequestError>>>;
}
