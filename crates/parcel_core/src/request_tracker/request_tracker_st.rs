use std::collections::HashMap;
use std::fmt::Debug;

use petgraph::graph::NodeIndex;

use super::request_graph::RequestError;
use super::request_graph::RequestGraph;
use super::request_graph::RequestGraphNode;
use super::request_graph::RequestNode;
use super::request_graph::RequestNodeState;
use super::Request;
use super::RequestResult;
use super::RequestTracker;

#[derive(Debug)]
pub struct RequestTrackerSingleThreaded<T: Send + Debug> {
  graph: RequestGraph<T>,
  requests: HashMap<u64, NodeIndex>,
}

impl<T: Send + Debug> RequestTrackerSingleThreaded<T> {
  pub fn new() -> Self {
    Self {
      graph: RequestGraph::new(),
      requests: HashMap::new(),
    }
  }

  pub fn start_request(&mut self, request: Box<dyn Request<T>>) -> bool {
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

  pub fn finish_request(&mut self, id: u64, result: Result<T, Vec<RequestError>>) {
    let node_index = self.requests.get(&id).unwrap();
    let request = match self.graph.node_weight_mut(*node_index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    };
    if request.state == RequestNodeState::Valid {
      return;
    }
    request.state = match result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    request.output = Some(result);
  }

  pub fn get_request_result<R: Request<T>>(&self, request: &R) -> &Result<T, Vec<RequestError>> {
    let request = self.get_request(request);
    request.output.as_ref().unwrap()
  }

  fn get_request<R: Request<T>>(&self, request: &R) -> &RequestNode<T> {
    let id = request.id();
    let node_index = self.requests.get(&id).unwrap();
    match self.graph.node_weight(*node_index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    }
  }
}



impl<T: Send + Debug> RequestTracker<T> for RequestTrackerSingleThreaded<T> {
    fn run_request(&mut self, request: Box<dyn Request<T>>) -> Result<RequestResult<T>, Vec<RequestError>> {
        let should_run = self.start_request(request);
        if should_run {
            let result = request.run(self.clone());
            self.finish_request(request.id(), result)
        }
        todo!()
    }

    // fn run_requests(&self, requests: &[Box<dyn Request<T>>]) -> Vec<Result<RequestResult<T>, Vec<RequestError>>> {
    //     todo!()
    // }
}
  