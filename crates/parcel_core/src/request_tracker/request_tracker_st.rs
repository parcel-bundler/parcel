use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::Debug;
use std::rc::Rc;
use std::sync::Arc;

use petgraph::dot::Config;
use petgraph::dot::Dot;
use petgraph::graph::NodeIndex;

use super::request_graph::RequestEdgeType;
use super::request_graph::RequestGraph;
use super::request_graph::RequestNode;
use super::request_graph::RequestNodeState;
use super::Request;
use super::RequestError;
use super::RequestResult;
use super::RequestTracker;
use super::RunRequestContext;

#[derive(Clone)]
pub struct RequestTrackerSingleThreaded<Res, Provide>
where
  Res: Send + Debug + Clone + 'static,
  Provide: Send + Clone + 'static,
{
  graph: Rc<RefCell<RequestGraph<RequestResult<Res>>>>,
  requests: Rc<RefCell<HashMap<u64, NodeIndex>>>,
  provide: Provide,
}

impl<Res, Provide> RequestTrackerSingleThreaded<Res, Provide>
where
  Res: Send + Debug + Clone + 'static,
  Provide: Send + Clone + 'static,
{
  pub fn new(provide: Provide) -> Self {
    let mut graph = RequestGraph::new();
    graph.add_node(RequestNode {
      state: RequestNodeState::Valid,
      output: None,
    });
    Self {
      graph: Rc::new(RefCell::new(graph)),
      requests: Rc::new(RefCell::new(HashMap::new())),
      provide,
    }
  }

  fn start_request(&self, request: &Arc<dyn Request<Res, Provide>>) -> bool {
    let mut requests = self.requests.borrow_mut();
    let mut graph = self.graph.borrow_mut();

    let request_id = request.id();
    let index = requests.entry(request_id).or_insert_with(|| {
      graph.add_node(RequestNode {
        state: RequestNodeState::Incomplete,
        output: None,
      })
    });

    let request = graph.node_weight_mut(*index).unwrap();

    if request.state == RequestNodeState::Valid {
      return false;
    }

    request.state = RequestNodeState::Incomplete;
    request.output = None;

    // TODO: clear invalidations

    true
  }

  fn finish_request(&self, id: &u64, result: Result<RequestResult<Res>, Vec<RequestError>>) {
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

impl<Res, Provide> RequestTracker<Res, Provide> for RequestTrackerSingleThreaded<Res, Provide>
where
  Res: Send + Debug + Clone + 'static,
  Provide: Send + Clone + 'static,
{
  fn run_request(
    &self,
    parent_ctx: Option<Arc<RunRequestContext<Res, Provide>>>,
    request: Arc<dyn Request<Res, Provide>>,
  ) -> Result<RequestResult<Res>, Vec<RequestError>> {
    let request_id = request.id();

    let should_run = self.start_request(&request);
    if should_run {
      let request_context = RunRequestContext {
        request_tracker: Box::new(self.clone()),
        parent_node: Some(request_id.clone()),
        provide: self.provide.clone(),
      };
      let result = request.run(Arc::new(request_context));
      self.finish_request(&request_id, result);
    }
    let mut graph = self.graph.borrow_mut();
    let requests = self.requests.borrow();

    let node_index = requests.get(&request_id).unwrap().clone();

    if let Some(parent_ctx) = parent_ctx {
      if let Some(parent_request_id) = parent_ctx.parent_node {
        let parent_node_index = requests.get(&parent_request_id).unwrap();
        graph.add_edge(
          parent_node_index.clone(),
          node_index,
          RequestEdgeType::SubRequest,
        );
      }
    } else {
      graph.add_edge(NodeIndex::new(0), node_index, RequestEdgeType::SubRequest);
    }

    let r = graph.node_weight(node_index).unwrap();
    r.output.as_ref().unwrap().clone()
  }
}

impl<Res, Provide> Debug for RequestTrackerSingleThreaded<Res, Provide>
where
  Res: Send + Debug + Clone + 'static,
  Provide: Send + Clone + 'static,
{
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let graph = self.graph.borrow();
    let dot = Dot::with_config(&*graph, &[Config::EdgeNoLabel]);
    write!(f, "{:?}", dot)
  }
}
