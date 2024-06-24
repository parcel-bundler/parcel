use std::collections::HashMap;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use anyhow::anyhow;
use parcel_core::cache::{CacheRef, MockCache};
use parcel_core::plugin::composite_reporter_plugin::CompositeReporterPlugin;
use petgraph::graph::NodeIndex;
use petgraph::stable_graph::StableDiGraph;

use crate::plugins::PluginsRef;
use parcel_core::plugin::ReporterEvent;
use parcel_core::plugin::ReporterPlugin;
use parcel_filesystem::{FileSystemRef, MockFileSystem};

use super::RequestEdgeType;
use super::RequestGraph;
use super::RequestNode;
use super::ResultAndInvalidations;
use super::RunRequestError;
use super::{Request, RunRequestContext, RunRequestMessage};

#[cfg(test)]
#[derive(Clone, Debug)]
pub enum ParcelRequestResult {
  Test(Vec<u64>),
}

#[cfg(not(test))]
#[derive(Clone, Debug)]
pub enum ParcelRequestResult {
  // ...
}

#[derive(Debug)]
enum RequestQueueMessage {
  RunRequest {
    tx: Sender<RequestQueueMessage>,
    message: RunRequestMessage<ParcelRequestResult>,
  },
  RequestResult {
    request_id: u64,
    parent_request_id: Option<u64>,
    result: Result<ResultAndInvalidations<ParcelRequestResult>, RunRequestError>,
    response_tx: Option<Sender<anyhow::Result<ParcelRequestResult>>>,
  },
}
pub struct RequestTracker {
  graph: RequestGraph<ParcelRequestResult>,
  reporter: Arc<dyn ReporterPlugin>,
  request_index: HashMap<u64, NodeIndex>,
  cache: CacheRef,
  file_system: FileSystemRef,
  plugins: PluginsRef,
}

// impl Default for RequestTracker {
//   fn default() -> Self {
//     RequestTracker::new(
//       Box::new(CompositeReporterPlugin::new(vec![])),
//       Arc::new(MockCache::new()),
//       Arc::new(MockFileSystem::new()),
//       Arc::new(P::new()),
//     )
//   }
// }

impl RequestTracker {
  pub fn new(
    reporter: Arc<dyn ReporterPlugin>,
    cache: CacheRef,
    file_system: FileSystemRef,
    plugins: PluginsRef,
  ) -> Self {
    let mut graph = StableDiGraph::<RequestNode<ParcelRequestResult>, RequestEdgeType>::new();
    graph.add_node(RequestNode::Root);
    RequestTracker {
      graph,
      reporter,
      request_index: HashMap::new(),
      cache,
      file_system,
      plugins,
    }
  }

  pub fn report(&self, event: ReporterEvent) {
    let _ = self.reporter.report(&event);
  }

  pub fn run_request(
    &mut self,
    request: impl Request<ParcelRequestResult>,
  ) -> anyhow::Result<ParcelRequestResult> {
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
        tracing::info!(?result, "Executing");
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
            let handle = || -> anyhow::Result<()> {
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
                );

                scope.spawn({
                  let tx = tx.clone();
                  move |_scope| {
                    let result = request.run(context);
                    let _ = tx.send(RequestQueueMessage::RequestResult {
                      request_id,
                      parent_request_id,
                      result,
                      response_tx, // <- this doesn't get dropped
                    });
                  }
                })
              }
              Ok(())
            };
            if let Err(err) = handle() {
              // ...
            }
          }
          RequestQueueMessage::RequestResult {
            request_id,
            parent_request_id,
            result,
            response_tx,
          } => {
            if let Err(err) = self.store_request(request_id, result) {
              // ...
            }

            let result = self.get_request(parent_request_id, request_id);
            tracing::info!(?result, "Sending back response");
            if let Some(response_tx) = response_tx {
              let _ = response_tx.send(result);
            }
          }
        }
      }

      self.get_request(None, request_id)
    })
  }

  // pub fn run_request(&mut self, request: &impl Request<T>) -> anyhow::Result<T> {
  //   self.run_child_request(request, None)
  // }
  //
  // pub fn run_child_request(
  //   &mut self,
  //   request: &impl Request<T>,
  //   parent_request_hash: Option<u64>,
  // ) -> anyhow::Result<T> {
  //   let request_id = request.id();
  //
  //   if self.prepare_request(request_id.clone())? {
  //     let result = request.run(RunRequestContext::new(Some(request_id), self));
  //     self.store_request(&request_id, result)?;
  //   }
  //
  //   Ok(self.get_request(parent_request_hash, &request_id)?)
  // }

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
    if let RequestNode::<ParcelRequestResult>::Valid(_) = request_node {
      return Ok(false);
    }

    *request_node = RequestNode::Incomplete;
    Ok(true)
  }

  fn store_request(
    &mut self,
    request_id: u64,
    result: Result<ResultAndInvalidations<ParcelRequestResult>, RunRequestError>,
  ) -> anyhow::Result<()> {
    let node_index = self
      .request_index
      .get(&request_id)
      .ok_or_else(|| anyhow!("Failed to find request"))?;
    let request_node = self
      .graph
      .node_weight_mut(*node_index)
      .ok_or_else(|| anyhow!("Failed to find request"))?;
    if let RequestNode::<ParcelRequestResult>::Valid(_) = request_node {
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
    request_id: u64,
  ) -> anyhow::Result<ParcelRequestResult> {
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

#[cfg(test)]
mod test {
  use crate::request_tracker::{
    ParcelRequestResult, Request, RequestTracker, ResultAndInvalidations, RunRequestContext,
    RunRequestError,
  };
  use crate::test_utils::{make_test_plugin_context, plugins};
  use parcel_core::cache::MockCache;
  use parcel_core::plugin::composite_reporter_plugin::CompositeReporterPlugin;
  use parcel_filesystem::MockFileSystem;
  use rand::random;
  use std::sync::mpsc::channel;
  use std::sync::Arc;

  #[derive(Debug, Hash)]
  struct TestRequest {
    remaining: usize,
  }
  impl Request<ParcelRequestResult> for TestRequest {
    fn run(
      &self,
      mut request_context: RunRequestContext<ParcelRequestResult>,
    ) -> Result<ResultAndInvalidations<ParcelRequestResult>, RunRequestError> {
      let thread_id = std::thread::current().id();
      tracing::info!(?thread_id, "Running {}", self.remaining);
      let responses: Vec<u64> = vec![random()];
      if self.remaining > 0 {
        let (tx, rx) = channel();
        let _ = request_context.queue_request(
          TestRequest {
            remaining: self.remaining - 1,
          },
          tx,
        );
        while let Ok(response) = rx.recv() {
          tracing::info!("result {:?}", response);
        }
      }

      Ok(ResultAndInvalidations {
        result: ParcelRequestResult::Test(responses),
        invalidations: vec![],
      })
    }
  }

  #[test]
  fn test_request_tracker() {
    tracing_subscriber::fmt::init();

    let mut request_tracker = RequestTracker::new(
      Arc::new(CompositeReporterPlugin::new(vec![])),
      Arc::new(MockCache::new()),
      Arc::new(MockFileSystem::new()),
      Arc::new(plugins(make_test_plugin_context())),
    );
    let result = request_tracker.run_request(TestRequest { remaining: 10 });
    assert!(result.is_ok());
    tracing::info!("Got result {:?}", result);
  }
}
