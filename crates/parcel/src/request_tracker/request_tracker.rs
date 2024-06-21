use std::collections::HashMap;

use anyhow::anyhow;
use petgraph::graph::NodeIndex;
use petgraph::stable_graph::StableDiGraph;

use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;

use super::Request;
use super::RequestEdgeType;
use super::RequestGraph;
use super::RequestNode;
use super::RequestResult;
use super::RunRequestContext;
use super::RunRequestError;

pub struct RequestTracker<T> {
  graph: RequestGraph<T>,
  reporters: Vec<Box<dyn ReporterPlugin>>,
  request_index: HashMap<u64, NodeIndex>,
}

impl<T: Clone> Default for RequestTracker<T> {
  fn default() -> Self {
    RequestTracker::new(Vec::new())
  }
}

impl<T: Clone> RequestTracker<T> {
  pub fn new(reporters: Vec<Box<dyn ReporterPlugin>>) -> Self {
    let mut graph = StableDiGraph::<RequestNode<T>, RequestEdgeType>::new();
    graph.add_node(RequestNode::Root);
    RequestTracker {
      graph,
      reporters,
      request_index: HashMap::new(),
    }
  }

  pub fn report(&self, event: ReporterEvent) {
    for reporter in self.reporters.iter() {
      // TODO Decide how to handle errors
      let _ = reporter.report(&event);
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
