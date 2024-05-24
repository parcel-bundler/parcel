use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::Debug;
use std::rc::Rc;

use petgraph::graph::NodeIndex;

use super::request_graph::RequestError;
use super::request_graph::RequestGraph;
// use super::request_graph::RequestGraphNode;
use super::request_graph::RequestNode;
use super::request_graph::RequestNodeState;
use super::Request;
use super::RequestResult;
use super::RequestTracker;

#[derive(Clone)]
pub struct RequestTrackerSingleThreaded<Res: Send + Debug + Clone> {
  graph: Rc<RefCell<RequestGraph<RequestResult<Res>>>>,
  requests: Rc<RefCell<HashMap<u64, NodeIndex>>>,
}

impl<Res: Send + Debug + Clone> Debug for RequestTrackerSingleThreaded<Res> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("RequestTrackerSingleThreaded {}")
      .finish()
  }
}

impl<Res: Send + Debug + Clone> RequestTrackerSingleThreaded<Res> {
  pub fn new() -> Self {
    Self {
      graph: Rc::new(RefCell::new(RequestGraph::new())),
      requests: Rc::new(RefCell::new(HashMap::new())),
    }
  }

  pub fn start_request(&self, request: &Box<dyn Request<Res>>) -> bool {
    let mut requests = self.requests.borrow_mut();
    let mut graph = self.graph.borrow_mut();

    let id = request.id();
    let index = requests.entry(id).or_insert_with(|| {
      self
        .graph
        .borrow_mut()
        .add_node(RequestNode {
          state: RequestNodeState::Incomplete,
          output: None,
        })
    });

    // todo
    let request = graph.node_weight_mut(*index).unwrap();

    if request.state == RequestNodeState::Valid {
      return false;
    }

    request.state = RequestNodeState::Incomplete;
    request.output = None;

    // TODO: clear invalidations

    true
  }

  pub fn finish_request(&self, id: &u64, result: Result<RequestResult<Res>, Vec<RequestError>>) {
    let requests = self.requests.borrow();
    let mut graph = self.graph.borrow_mut();

    let node_index = requests.get(&id).unwrap();
    // todo
    let request = graph.node_weight_mut(*node_index).unwrap();
    if request.state == RequestNodeState::Valid {
      return;
    }
    request.state = match result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    request.output = Some(result);
  }
}

impl<Res: Send + Debug + Clone + 'static> RequestTracker<Res> for RequestTrackerSingleThreaded<Res> {
  fn run_request(
    &self,
    request: Box<dyn Request<Res>>,
  ) -> Result<RequestResult<Res>, Vec<RequestError>> {
    let graph = self.graph.borrow();
    
    let request_id = request.id();

    let should_run = self.start_request(&request);
    if should_run {
      let result = request.run(Box::new(self.clone()));
      self.finish_request(&request_id, result);
    } 
    let node_index = self.requests.borrow().get(&request_id).unwrap().clone();
    let r = graph.node_weight(node_index).unwrap();
    r.output.as_ref().unwrap().clone()
  }

  // fn run_requests(&self, requests: &[Box<dyn Request<T>>]) -> Vec<Result<RequestResult<T>, Vec<RequestError>>> {
  //     todo!()
  // }
}
