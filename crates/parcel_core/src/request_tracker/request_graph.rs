use petgraph::graph::DiGraph;

pub type RequestGraph<T> = DiGraph<RequestGraphNode<T>, RequestEdgeType>;

#[allow(dead_code)]
#[derive(Debug)]
pub enum RequestGraphNode<T> {
  FileName,
  Option,
  ConfigKey,
  Request(RequestNode<T>),
}

#[derive(Debug)]
pub struct RequestNode<T> {
  pub state: RequestNodeState,
  pub output: Option<Result<T, RequestError>>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub enum RequestEdgeType {
  SubRequest,
  InvalidatedByUpdate,
  InvalidatedByDelete,
  InvalidatedByCreate,
  InvalidateByCreateAbove,
  Dirname,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug)]
pub enum RequestNodeState {
  Incomplete,
  Invalid,
  Error,
  Valid,
}

#[derive(Clone, Debug)]
pub enum RequestError {}
