use std::fmt::Debug;

use petgraph::graph::DiGraph;

pub type RequestGraph<T> = DiGraph<RequestNode<T>, RequestEdgeType>;

pub struct RequestNode<T: Clone> {
  pub state: RequestNodeState,
  pub output: Option<Result<T, Vec<RequestError>>>,
}

impl<T: Clone + std::fmt::Debug> std::fmt::Debug for RequestNode<T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self.state {
      RequestNodeState::Incomplete => write!(f, "Incomplete()"),
      RequestNodeState::Invalid => write!(f, "Invalid()"),
      RequestNodeState::Error => write!(f, "Error()"),
      RequestNodeState::Valid => {
        if let Some(output) = &self.output {
          let result = output.as_ref().unwrap();
          return write!(f, "Valid({:?})", result);
        }
        write!(f, "Valid(Root)")
      }
    }
  }
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
