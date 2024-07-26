use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use parcel_core::asset_graph::{AssetGraph, DependencyNode, DependencyState};
use parcel_core::types::Dependency;
use pathdiff::diff_paths;
use petgraph::graph::NodeIndex;

use crate::request_tracker::{Request, ResultAndInvalidations, RunRequestContext, RunRequestError};

use super::asset_request::{AssetRequest, AssetRequestOutput};
use super::entry_request::{EntryRequest, EntryRequestOutput};
use super::path_request::{PathRequest, PathRequestOutput};
use super::target_request::{TargetRequest, TargetRequestOutput};
use super::RequestResult;

type ResultSender = Sender<Result<(RequestResult, u64), anyhow::Error>>;
type ResultReceiver = Receiver<Result<(RequestResult, u64), anyhow::Error>>;

/// The AssetGraphRequest is in charge of building the AssetGraphRequest
/// In doing so, it kicks of the EntryRequest, TargetRequest, PathRequest and AssetRequests.
#[derive(Debug, Hash)]
pub struct AssetGraphRequest {}

#[derive(Clone, Debug, PartialEq)]
pub struct AssetGraphRequestOutput {
  pub graph: AssetGraph,
}

impl Request for AssetGraphRequest {
  fn run(
    &self,
    request_context: RunRequestContext,
  ) -> Result<ResultAndInvalidations, RunRequestError> {
    let builder = AssetGraphBuilder::new(request_context);

    builder.build()
  }
}

struct AssetGraphBuilder {
  request_id_to_dep_node_index: HashMap<u64, NodeIndex>,
  graph: AssetGraph,
  visited: HashSet<u64>,
  work_count: u32,
  request_context: RunRequestContext,
  sender: ResultSender,
  receiver: ResultReceiver,
  asset_request_to_asset: HashMap<u64, NodeIndex>,
  waiting_asset_requests: HashMap<u64, HashSet<NodeIndex>>,
}

impl AssetGraphBuilder {
  fn new(request_context: RunRequestContext) -> Self {
    let (sender, receiver) = channel();

    AssetGraphBuilder {
      request_id_to_dep_node_index: HashMap::new(),
      graph: AssetGraph::new(),
      visited: HashSet::new(),
      work_count: 0,
      request_context,
      sender,
      receiver,
      asset_request_to_asset: HashMap::new(),
      waiting_asset_requests: HashMap::new(),
    }
  }

  fn build(mut self) -> Result<ResultAndInvalidations, RunRequestError> {
    for entry in self.request_context.options.clone().entries.iter() {
      self.work_count += 1;
      let _ = self.request_context.queue_request(
        EntryRequest {
          entry: entry.clone(),
        },
        self.sender.clone(),
      );
    }

    loop {
      // TODO: Should the work count be tracked on the request_context as part of
      // the queue_request API?
      if self.work_count == 0 {
        break;
      }

      let Ok(result) = self.receiver.recv() else {
        break;
      };

      self.work_count -= 1;

      match result {
        Ok((RequestResult::Entry(EntryRequestOutput { entries }), _request_id)) => {
          self.handle_entry_result(entries);
        }
        Ok((RequestResult::Target(TargetRequestOutput { entry, targets }), _request_id)) => {
          self.handle_target_request_result(targets, entry);
        }
        Ok((
          RequestResult::Asset(AssetRequestOutput {
            asset,
            dependencies,
          }),
          request_id,
        )) => {
          self.handle_asset_result(request_id, asset, dependencies);
        }
        Ok((RequestResult::Path(result), request_id)) => {
          self.handle_path_result(request_id, result);
        }
        other => {
          // This is an error...
          todo!("{:?}", other);
        }
      }
    }

    Ok(ResultAndInvalidations {
      result: RequestResult::AssetGraph(AssetGraphRequestOutput { graph: self.graph }),
      invalidations: vec![],
    })
  }

  fn handle_path_result(&mut self, request_id: u64, result: PathRequestOutput) {
    let node = *self
      .request_id_to_dep_node_index
      .get(&request_id)
      .expect("Missing node index for request id {request_id}");
    let dep_index = self.graph.dependency_index(node).unwrap();
    let DependencyNode {
      dependency,
      requested_symbols,
      state,
    } = &mut self.graph.dependencies[dep_index];
    let asset_request = match result {
      PathRequestOutput::Resolved {
        path,
        code,
        pipeline,
        side_effects,
        query,
        can_defer,
      } => {
        if !side_effects && can_defer && requested_symbols.is_empty() && dependency.has_symbols {
          *state = DependencyState::Deferred;
          return;
        }

        *state = DependencyState::Resolved;
        AssetRequest {
          file_path: path,
          code: code.clone(),
          pipeline: pipeline.clone(),
          side_effects,
          // TODO: Dependency.env should be an Arc by default
          env: Arc::new(dependency.env.clone()),
          query,
        }
      }
      PathRequestOutput::Excluded => {
        *state = DependencyState::Excluded;
        return;
      }
    };
    let id = asset_request.id();

    if self.visited.insert(id) {
      self.request_id_to_dep_node_index.insert(id, node);
      self.work_count += 1;
      let _ = self
        .request_context
        .queue_request(asset_request, self.sender.clone());
    } else if let Some(asset_node_index) = self.asset_request_to_asset.get(&id) {
      // We have already completed this AssetRequest so we can connect the
      // Dependency to the Asset immediately
      self.graph.add_edge(asset_node_index, &node);
      self.graph.propagate_requested_symbols(
        *asset_node_index,
        node,
        &mut |dependency_node_index: NodeIndex, dependency: Arc<Dependency>| {
          let request = PathRequest {
            dependency: dependency.clone(),
          };

          self
            .request_id_to_dep_node_index
            .insert(request.id(), dependency_node_index);
          tracing::debug!(
            "queueing a path request from on_undeferred, {}",
            dependency.specifier
          );
          self.work_count += 1;
          let _ = self
            .request_context
            .queue_request(request, self.sender.clone());
        },
      );
    } else {
      // The AssetRequest has already been kicked off but is yet to
      // complete. Register this Dependency to be connected once it
      // completes
      self
        .waiting_asset_requests
        .entry(id)
        .and_modify(|nodes| {
          nodes.insert(node);
        })
        .or_insert_with(|| HashSet::from([node]));
    }
  }

  fn handle_entry_result(&mut self, entries: Vec<super::entry_request::Entry>) {
    for entry in entries {
      let target_request = TargetRequest {
        default_target_options: self.request_context.options.default_target_options.clone(),
        entry,
        env: self.request_context.options.env.clone(),
        mode: self.request_context.options.mode.clone(),
      };

      self.work_count += 1;
      let _ = self
        .request_context
        .queue_request(target_request, self.sender.clone());
    }
  }

  fn handle_asset_result(
    &mut self,
    request_id: u64,
    asset: parcel_core::types::Asset,
    dependencies: Vec<Dependency>,
  ) {
    let incoming_dep_node_index = *self
      .request_id_to_dep_node_index
      .get(&request_id)
      .expect("Missing node index for request id {request_id}");

    // Connect the incoming DependencyNode to the new AssetNode
    let asset_node_index = self.graph.add_asset(incoming_dep_node_index, asset.clone());

    self
      .asset_request_to_asset
      .insert(request_id, asset_node_index);

    // Connect dependencies of the Asset
    for dependency in &dependencies {
      let _ = self
        .graph
        .add_dependency(asset_node_index, dependency.clone(), HashSet::default());
    }

    self.graph.propagate_requested_symbols(
      asset_node_index,
      incoming_dep_node_index,
      &mut |dependency_node_index: NodeIndex, dependency: Arc<Dependency>| {
        let request = PathRequest {
          dependency: dependency.clone(),
        };

        self
          .request_id_to_dep_node_index
          .insert(request.id(), dependency_node_index);
        tracing::debug!(
          "queueing a path request from on_undeferred, {}",
          dependency.specifier
        );
        self.work_count += 1;
        let _ = self
          .request_context
          .queue_request(request, self.sender.clone());
      },
    );

    // Connect any previously discovered Dependencies that were waiting
    // for this AssetNode to be created
    if let Some(waiting) = self.waiting_asset_requests.remove(&request_id) {
      for dep in waiting {
        self.graph.add_edge(&dep, &asset_node_index);
        self.graph.propagate_requested_symbols(
          asset_node_index,
          dep,
          &mut |dependency_node_index: NodeIndex, dependency: Arc<Dependency>| {
            let request = PathRequest {
              dependency: dependency.clone(),
            };

            self
              .request_id_to_dep_node_index
              .insert(request.id(), dependency_node_index);
            tracing::debug!(
              "queueing a path request from on_undeferred, {}",
              dependency.specifier
            );
            self.work_count += 1;
            let _ = self
              .request_context
              .queue_request(request, self.sender.clone());
          },
        );
      }
    }
  }

  fn handle_target_request_result(
    &mut self,
    targets: Vec<parcel_core::types::Target>,
    entry: std::path::PathBuf,
  ) {
    for target in targets {
      let entry =
        diff_paths(&entry, &self.request_context.project_root).unwrap_or_else(|| entry.clone());

      let dependency = Dependency::entry(entry.to_str().unwrap().to_string(), target);
      let mut requested_symbols = HashSet::default();

      if dependency.env.is_library {
        requested_symbols.insert("*".into());
      }

      let dep_node =
        self
          .graph
          .add_dependency(NodeIndex::new(0), dependency.clone(), requested_symbols);

      let request = PathRequest {
        dependency: Arc::new(dependency),
      };
      self
        .request_id_to_dep_node_index
        .insert(request.id(), dep_node);
      self.work_count += 1;
      let _ = self
        .request_context
        .queue_request(request, self.sender.clone());
    }
  }
}
