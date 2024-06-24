use anyhow::anyhow;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

use petgraph::graph::NodeIndex;
use petgraph::stable_graph::StableDiGraph;

use super::Request;
use super::RequestEdgeType;
use super::RequestGraph;
use super::RequestNode;
use super::RequestResult;
use super::RunRequestContext;
use super::RunRequestError;

pub struct RequestTracker<T> {
  graph: RequestGraph<T>,
  request_index: HashMap<u64, NodeIndex>,
}

impl<T: Clone + Send> RequestTracker<T> {
  pub fn new() -> Self {
    let mut graph = StableDiGraph::<RequestNode<T>, RequestEdgeType>::new();
    graph.add_node(RequestNode::Root);
    RequestTracker {
      graph,
      request_index: HashMap::new(),
    }
  }

  pub fn run_request(&mut self, request: &impl Request<T>) -> anyhow::Result<T> {
    self.run_child_request(request, None)
  }

  pub fn run_child_request(
    &mut self,
    request: &impl Request<T>,
    parent_request_hash: Option<u64>,
  ) -> anyhow::Result<T> {
    let request_id = request.id();

    if self.prepare_request(request_id.clone())? {
      let result = request.run(RunRequestContext::new(Some(request_id), self));
      self.store_request(&request_id, result)?;
    }

    Ok(self.get_request(parent_request_hash, &request_id)?)
  }

  fn prepare_request(&mut self, request_id: u64) -> anyhow::Result<bool> {
    let node_index = self
      .request_index
      .entry(request_id)
      .or_insert_with(|| self.graph.add_node(RequestNode::Incomplete));

    let request_node = self
      .graph
      .node_weight_mut(*node_index)
      .ok_or_else(|| anyhow!("Failed to find request node"))?;

    // Don't run if already run
    if let RequestNode::<T>::Valid(_) = request_node {
      return Ok(false);
    }

    *request_node = RequestNode::Incomplete;
    Ok(true)
  }

  fn store_request(
    &mut self,
    request_id: &u64,
    result: Result<RequestResult<T>, RunRequestError>,
  ) -> anyhow::Result<()> {
    let node_index = self
      .request_index
      .get(&request_id)
      .ok_or_else(|| anyhow!("Failed to find request"))?;
    let request_node = self
      .graph
      .node_weight_mut(*node_index)
      .ok_or_else(|| anyhow!("Failed to find request"))?;
    if let RequestNode::<T>::Valid(_) = request_node {
      return Ok(());
    }
    *request_node = match result {
      Ok(result) => RequestNode::Valid(result.result),
      Err(error) => RequestNode::Error(error),
    };

    Ok(())
  }

  fn get_request(
    &mut self,
    parent_request_hash: Option<u64>,
    request_id: &u64,
  ) -> anyhow::Result<T> {
    let Some(node_index) = self.request_index.get(&request_id) else {
      return Err(anyhow!("Impossible error"));
    };

    if let Some(parent_request_id) = parent_request_hash {
      let parent_node_index = self
        .request_index
        .get(&parent_request_id)
        .ok_or_else(|| anyhow!("Failed to find requests"))?;
      self.graph.add_edge(
        parent_node_index.clone(),
        node_index.clone(),
        RequestEdgeType::SubRequest,
      );
    } else {
      self.graph.add_edge(
        NodeIndex::new(0),
        node_index.clone(),
        RequestEdgeType::SubRequest,
      );
    }

    let Some(request_node) = self.graph.node_weight(node_index.clone()) else {
      return Err(anyhow!("Impossible"));
    };

    match request_node {
      RequestNode::Root => Err(anyhow!("Impossible")),
      RequestNode::Incomplete => Err(anyhow!("Impossible")),
      RequestNode::Error(_errors) => Err(anyhow!("Impossible")),
      RequestNode::Valid(value) => Ok(value.clone()),
    }
  }
}

enum ChannelResult<T> {
  Executed((u64, Result<RequestResult<T>, RunRequestError>)),
  Cached(anyhow::Result<T>),
}
pub struct RequestQueue<'a, 'scope, T> {
  scope: &'a rayon::Scope<'scope>,
  request_tracker: &'scope mut RequestTracker<T>,
  parent_request_hash: Option<u64>,
  sender: crossbeam_channel::Sender<ChannelResult<T>>,
  receiver: crossbeam_channel::Receiver<ChannelResult<T>>,
}

impl<'a, 'scope, T: Clone + Send + 'scope> RequestQueue<'a, 'scope, T> {
  pub fn new(
    scope: &'a rayon::Scope<'scope>,
    request_tracker: Arc<RequestTracker<T>>,
    parent_request_hash: Option<u64>,
  ) -> Self {
    let (sender, receiver) = crossbeam_channel::unbounded();
    Self {
      scope,
      request_tracker,
      parent_request_hash,
      sender,
      receiver,
    }
  }

  pub fn queue_request(
    &mut self,
    request: Box<dyn Request<T> + Send + 'scope>,
  ) -> anyhow::Result<()> {
    let request_id = request.id();
    // let mut rt = self
    //   .request_tracker
    //   .lock()
    //   .map_err(|_| anyhow::anyhow!("Failed to acquire request tracker lock"))?;
    let rt = self.request_tracker;
    if rt.prepare_request(request_id.clone())? {
      let sender = self.sender.clone();

      self.scope.spawn(move |_| {
        let result = request.run(RunRequestContext::new(Some(request_id), rt));

        sender.send(ChannelResult::Executed((request_id, result)));
      });
    } else {
      self.sender.send(ChannelResult::Cached(
        rt.get_request(self.parent_request_hash, &request_id),
      ));
    }
    Ok(())
  }

  pub fn receive_result(&self, handler: &dyn Fn(anyhow::Result<T>)) {
    for channel_result in self.receiver.recv() {
      match channel_result {
        ChannelResult::Cached(result) => {
          handler(result);
        }
        ChannelResult::Executed((request_id, result)) => {
          let rt_result = self
            .request_tracker
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to acquire request tracker lock"));

          let mut rt = match rt_result {
            Err(err) => {
              return handler(Err(err));
            }
            Ok(rt) => rt,
          };

          if let Err(err) = rt.store_request(&request_id, result) {
            return handler(Err(err));
          }

          let result = rt.get_request(self.parent_request_hash, &request_id);
          handler(result);
        }
      }
    }
  }
}
