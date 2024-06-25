use petgraph::stable_graph::StableDiGraph;

pub type RequestGraph<T> = StableDiGraph<RequestNode<T>, RequestEdgeType>;

#[derive(Debug)]
pub enum RequestNode<T> {
  Error(String),
  Root,
  Incomplete,
  Valid(T),
}

#[derive(Debug)]
pub enum RequestEdgeType {
  SubRequest,
}
