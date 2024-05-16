use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock;

use petgraph::graph::DiGraph;
use petgraph::graph::NodeIndex;

use super::Request;
use super::StoreRequestOutput;
use crate::RequestError;
use crate::RequestOutput;

#[allow(dead_code)]
#[derive(Debug)]
enum RequestGraphNode {
  FileName,
  Option,
  ConfigKey,
  Request(RequestNode),
}

#[derive(Debug)]
struct RequestNode {
  state: RequestNodeState,
  output: Option<Result<RequestOutput, RequestError>>,
}

#[allow(dead_code)]
#[derive(PartialEq, Debug)]
enum RequestNodeState {
  Incomplete,
  Invalid,
  Error,
  Valid,
}

#[allow(dead_code)]
#[derive(Debug)]
enum RequestEdgeType {
  SubRequest,
  InvalidatedByUpdate,
  InvalidatedByDelete,
  InvalidatedByCreate,
  InvalidateByCreateAbove,
  Dirname,
}

#[derive(Debug, Clone)]
pub struct RequestTracker {
  graph: Arc<RwLock<DiGraph<RequestGraphNode, RequestEdgeType>>>,
  requests: Arc<RwLock<HashMap<u64, NodeIndex>>>,
}

impl RequestTracker {
  pub fn new() -> Self {
    RequestTracker {
      graph: Arc::new(RwLock::new(DiGraph::new())),
      requests: Arc::new(RwLock::new(HashMap::new())),
    }
  }

  fn start_request<R: Request>(&self, request: &R) -> bool {
    let id = request.id();
    let mut requests = self.requests.write().unwrap();
    let mut graph = self.graph.write().unwrap();

    let index = requests.entry(id).or_insert_with(|| {
      graph.add_node(RequestGraphNode::Request(RequestNode {
        state: RequestNodeState::Incomplete,
        output: None,
      }))
    });

    let request = match graph.node_weight_mut(*index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    };

    if request.state == RequestNodeState::Valid {
      return false;
    }

    request.state = RequestNodeState::Incomplete;
    request.output = None;

    // TODO: clear invalidations

    true
  }

  #[allow(dead_code)]
  fn has_valid_result<R: Request>(&self, request: &R) -> bool {
    let requests = self.requests.read().unwrap();
    let graph = self.graph.read().unwrap();

    let id = request.id();
    if let Some(index) = requests.get(&id) {
      return match graph.node_weight(*index) {
        Some(RequestGraphNode::Request(req)) => req.state == RequestNodeState::Valid,
        _ => false,
      };
    }

    false
  }

  pub fn run_request<R>(&self, request: R) -> Result<R::Output, RequestError>
  where
    R: Request + StoreRequestOutput,
  {
    let requests = self.requests.read().unwrap();
    let mut graph = self.graph.write().unwrap();

    let id = (&request).id();
    let node_index = (&requests).get(&id).unwrap();

    if !self.start_request(&request) {
      let Some(RequestGraphNode::Request(request)) = graph.node_weight(*node_index) else {
        unreachable!("expected a request node")
      };

      let res = request
        .output
        .as_ref()
        .unwrap()
        .as_ref()
        .map(|output| <R as StoreRequestOutput>::retrieve(output));

      return match res {
        Ok(r) => Ok(r.clone()),
        Err(e) => Err(e.clone()),
      };
    }

    let request_result = request.run();

    let Some(RequestGraphNode::Request(request)) = graph.node_weight_mut(*node_index) else {
      unreachable!("expected a request node")
    };

    request.state = match request_result.result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    // TODO: insert invalidations

    let request_result_result = {
      match request_result.result.clone() {
        Ok(result) => Ok(<R as StoreRequestOutput>::store(result)),
        Err(err) => Err(err),
      }
    };

    request.output = Some(request_result_result);

    request_result.result
  }
}
