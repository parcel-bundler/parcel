use petgraph::stable_graph::StableDiGraph;

use super::RequestError;

pub type RequestGraph<T> = StableDiGraph<RequestNode<T>, RequestEdgeType>;

#[derive(Debug)]
pub enum RequestNode<T> {
  Error(Vec<RequestError>),
  Root,
  Incomplete,
  Valid(T),
}

#[derive(Debug)]
pub enum RequestEdgeType {
  SubRequest,
}
