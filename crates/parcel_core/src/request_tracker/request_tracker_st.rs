use std::collections::HashMap;
use std::fmt::Debug;

use petgraph::graph::NodeIndex;

use super::request_graph::RequestError;
use super::request_graph::RequestGraph;
use super::request_graph::RequestGraphNode;
use super::request_graph::RequestNode;
use super::request_graph::RequestNodeState;
use super::request_tracker::RequestTracker;
use super::Request;

#[derive(Debug)]
pub struct RequestTrackerSingleThread<T: Send + Clone + Debug> {
  graph: RequestGraph<T>,
  requests: HashMap<u64, NodeIndex>,
}

impl<T: Send + Clone + Debug> RequestTrackerSingleThread<T> {
  pub fn new() -> Self {
    Self {
      graph: RequestGraph::new(),
      requests: HashMap::new(),
    }
  }

  fn should_start_request<R: Request<T>>(&mut self, request: &R) -> bool {
    let id = request.id();

    let index = self.requests.entry(id).or_insert_with(|| {
      self.graph.add_node(RequestGraphNode::Request(RequestNode {
        state: RequestNodeState::Incomplete,
        output: None,
      }))
    });

    let request = match self.graph.node_weight_mut(*index) {
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
  fn has_valid_result<R: Request<T>>(&self, request: &R) -> bool {
    let id = request.id();
    if let Some(index) = self.requests.get(&id) {
      return match self.graph.node_weight(*index) {
        Some(RequestGraphNode::Request(req)) => req.state == RequestNodeState::Valid,
        _ => false,
      };
    }

    false
  }
}

impl<T: Send + Clone + Debug> RequestTracker<T> for RequestTrackerSingleThread<T> {
  fn run_requests<R: Request<T>>(&mut self, requests: Vec<R>) -> Vec<Result<T, RequestError>> {
    // TODO concurrency
    let mut results = vec![];

    for request in requests {
      results.push(self.run_request(request));
    }

    results
  }

  fn run_request<R: Request<T>>(&mut self, request: R) -> Result<T, RequestError> {
    let id = (&request).id();
    let node_index = self.requests.get(&id).unwrap().clone();

    if !self.should_start_request(&request) {
      let Some(RequestGraphNode::Request(request)) = self.graph.node_weight(node_index) else {
        unreachable!("expected a request node")
      };

      // let res = request
      //   .output
      //   .as_ref()
      //   .unwrap()
      //   .as_ref()
      //   .map(|output| <R as StoreRequestOutput<T, D>>::retrieve(output));

      // return match res {
      //   Ok(r) => Ok(r.clone()),
      //   Err(e) => Err(e.clone()),
      // };
    }

    let request_result = request.run();

    let Some(RequestGraphNode::Request(request)) = self.graph.node_weight_mut(node_index) else {
      unreachable!("expected a request node")
    };

    request.state = match request_result.result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    // TODO: insert invalidations

    // let request_result_result = {
    //   match request_result.result.clone() {
    //     Ok(result) => Ok(<R as StoreRequestOutput<T, D>>::store(result)),
    //     Err(err) => Err(err),
    //   }
    // };

    // request.output = Some(request_result_result);

    request_result.result
  }
}
