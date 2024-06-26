use std::collections::HashMap;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use anyhow::anyhow;
use petgraph::graph::NodeIndex;
use petgraph::stable_graph::StableDiGraph;

use parcel_core::cache::CacheRef;
use parcel_core::config_loader::ConfigLoaderRef;
use parcel_core::plugin::composite_reporter_plugin::CompositeReporterPlugin;
use parcel_core::plugin::ReporterPlugin;
use parcel_filesystem::FileSystemRef;

use crate::plugins::PluginsRef;
use crate::requests::RequestResult;

use super::Request;
use super::RequestEdgeType;
use super::RequestGraph;
use super::RequestNode;
use super::ResultAndInvalidations;
use super::RunRequestError;
use super::{RunRequestContext, RunRequestMessage};

#[derive(Debug)]
enum RequestQueueMessage {
  RunRequest {
    tx: Sender<RequestQueueMessage>,
    message: RunRequestMessage,
  },
  RequestResult {
    request_id: u64,
    parent_request_id: Option<u64>,
    result: Result<ResultAndInvalidations, RunRequestError>,
    response_tx: Option<Sender<anyhow::Result<RequestResult>>>,
  },
}
pub struct RequestTracker {
  graph: RequestGraph<RequestResult>,
  reporter: Arc<CompositeReporterPlugin>,
  request_index: HashMap<u64, NodeIndex>,
  cache: CacheRef,
  file_system: FileSystemRef,
  plugins: PluginsRef,
  config_loader: ConfigLoaderRef,
}
impl RequestTracker {
  pub fn new(
    reporters: Vec<Box<dyn ReporterPlugin>>,
    cache: CacheRef,
    file_system: FileSystemRef,
    plugins: PluginsRef,
    config_loader: ConfigLoaderRef,
  ) -> Self {
    let mut graph = StableDiGraph::<RequestNode<RequestResult>, RequestEdgeType>::new();
    graph.add_node(RequestNode::Root);
    RequestTracker {
      graph,
      reporter: Arc::new(CompositeReporterPlugin::new(reporters)),
      request_index: HashMap::new(),
      cache,
      file_system,
      plugins,
      config_loader,
    }
  }

  /// Run a request that has no parent. Return the result.
  #[allow(unused)]
  pub fn run_request(&mut self, request: impl Request) -> anyhow::Result<RequestResult> {
    rayon::in_place_scope(|scope| {
      let request_id = request.id();
      let (tx, rx) = std::sync::mpsc::channel();
      let tx2 = tx.clone();
      let _ = tx.send(RequestQueueMessage::RunRequest {
        tx: tx2,
        message: RunRequestMessage {
          request: Box::new(request),
          parent_request_id: None,
          response_tx: None,
        },
      });
      drop(tx);

      while let Ok(result) = rx.recv() {
        match result {
          RequestQueueMessage::RunRequest {
            message:
              RunRequestMessage {
                request,
                parent_request_id,
                response_tx,
              },
            tx,
          } => {
            let request_id = request.id();
            if self.prepare_request(request_id)? {
              let context = RunRequestContext::new(
                Some(request_id),
                // sub-request run
                Box::new({
                  let tx = tx.clone();
                  move |message| {
                    let tx2 = tx.clone();
                    tx.send(RequestQueueMessage::RunRequest { message, tx: tx2 })
                      .unwrap();
                  }
                }),
                self.reporter.clone(),
                self.cache.clone(),
                self.file_system.clone(),
                self.plugins.clone(),
                self.config_loader.clone(),
              );

              scope.spawn({
                let tx = tx.clone();
                move |_scope| {
                  let result = request.run(context);
                  let _ = tx.send(RequestQueueMessage::RequestResult {
                    request_id,
                    parent_request_id,
                    result,
                    response_tx,
                  });
                }
              })
            } else {
              // Cached request
              if let Some(response_tx) = response_tx {
                let result = self.get_request(parent_request_id, request_id);
                let _ = response_tx.send(result);
              }
            };
          }
          RequestQueueMessage::RequestResult {
            request_id,
            parent_request_id,
            result,
            response_tx,
          } => {
            self.store_request(request_id, &result)?;
            self.link_request_to_parent(request_id, parent_request_id)?;

            if let Some(response_tx) = response_tx {
              let _ = response_tx.send(result.map(|result| result.result));
            }
          }
        }
      }

      self.get_request(None, request_id)
    })
  }

  /// Before a request is ran, a 'pending' `RequestNode::Incomplete` entry is added to the graph.
  #[allow(unused)]
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
    if let RequestNode::<RequestResult>::Valid(_) = request_node {
      return Ok(false);
    }

    *request_node = RequestNode::Incomplete;
    Ok(true)
  }

  /// Once a request finishes, its result is stored under its `RequestNode` entry on the graph
  #[allow(unused)]
  fn store_request(
    &mut self,
    request_id: u64,
    result: &Result<ResultAndInvalidations, RunRequestError>,
  ) -> anyhow::Result<()> {
    let node_index = self
      .request_index
      .get(&request_id)
      .ok_or_else(|| anyhow!("Failed to find request"))?;
    let request_node = self
      .graph
      .node_weight_mut(*node_index)
      .ok_or_else(|| anyhow!("Failed to find request"))?;
    if let RequestNode::<RequestResult>::Valid(_) = request_node {
      return Ok(());
    }
    *request_node = match result {
      Ok(result) => RequestNode::Valid(result.result.clone()),
      Err(error) => RequestNode::Error(error.to_string()),
    };

    Ok(())
  }

  /// Get a request result and call link_request_to_parent
  #[allow(unused)]
  fn get_request(
    &mut self,
    parent_request_hash: Option<u64>,
    request_id: u64,
  ) -> anyhow::Result<RequestResult> {
    self.link_request_to_parent(request_id, parent_request_hash)?;

    let Some(node_index) = self.request_index.get(&request_id) else {
      return Err(anyhow!("Impossible error"));
    };
    let Some(request_node) = self.graph.node_weight(*node_index) else {
      return Err(anyhow!("Impossible"));
    };

    match request_node {
      RequestNode::Root => Err(anyhow!("Impossible")),
      RequestNode::Incomplete => Err(anyhow!("Impossible")),
      RequestNode::Error(error) => Err(anyhow!(error.clone())),
      RequestNode::Valid(value) => Ok(value.clone()),
    }
  }

  /// Create an edge between a parent request and the target request.
  #[allow(unused)]
  fn link_request_to_parent(
    &mut self,
    request_id: u64,
    parent_request_hash: Option<u64>,
  ) -> anyhow::Result<()> {
    let Some(node_index) = self.request_index.get(&request_id) else {
      return Err(anyhow!("Impossible error"));
    };
    if let Some(parent_request_id) = parent_request_hash {
      let parent_node_index = self
        .request_index
        .get(&parent_request_id)
        .ok_or_else(|| anyhow!("Failed to find requests"))?;
      self
        .graph
        .add_edge(*parent_node_index, *node_index, RequestEdgeType::SubRequest);
    } else {
      self
        .graph
        .add_edge(NodeIndex::new(0), *node_index, RequestEdgeType::SubRequest);
    }
    Ok(())
  }
}
