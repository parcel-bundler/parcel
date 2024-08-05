use petgraph::stable_graph::StableDiGraph;

use crate::request_tracker::RunRequestError;

pub type RequestGraph<T> = StableDiGraph<RequestNode<T>, RequestEdgeType>;

#[derive(Debug)]
pub enum RequestNode<T> {
  Error(RunRequestError),
  Root,
  Incomplete,
  Valid(T),
}

#[derive(Debug)]
pub enum RequestEdgeType {
  SubRequest,
}
