use std::fmt::Debug;

use super::request_graph::RequestError;
use super::Request;

pub trait RequestTracker<T: Send + Clone + Debug> {
  fn run_requests<R: Request<T>>(&mut self, requests: Vec<R>) -> Vec<Result<T, RequestError>>;

  fn run_request<R: Request<T>>(&mut self, request: R) -> Result<T, RequestError>;
}
