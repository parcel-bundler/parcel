use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use anyhow::anyhow;
use pathdiff::diff_paths;
use petgraph::graph::NodeIndex;

use parcel_core::asset_graph::{AssetGraph, DependencyNode, DependencyState};
use parcel_core::types::Dependency;

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
        Ok((RequestResult::Entry(result), _request_id)) => {
          tracing::debug!("Handling EntryRequestOutput");
          self.handle_entry_result(result);
        }
        Ok((RequestResult::Target(result), _request_id)) => {
          tracing::debug!("Handling TargetRequestOutput");
          self.handle_target_request_result(result);
        }
        Ok((RequestResult::Asset(result), request_id)) => {
          tracing::debug!(
            "Handling AssetRequestOutput: {}",
            result.asset.file_path.display()
          );
          self.handle_asset_result(result, request_id);
        }
        Ok((RequestResult::Path(result), request_id)) => {
          tracing::debug!("Handling PathRequestOutput");
          self.handle_path_result(result, request_id);
        }
        Err(err) => return Err(err),
        // This branch should never occur
        Ok((result, request_id)) => {
          return Err(anyhow!(
            "Unexpected request result in AssetGraphRequest ({}): {:?}",
            request_id,
            result
          ))
        }
      }
    }

    Ok(ResultAndInvalidations {
      result: RequestResult::AssetGraph(AssetGraphRequestOutput { graph: self.graph }),
      invalidations: vec![],
    })
  }

  fn handle_path_result(&mut self, result: PathRequestOutput, request_id: u64) {
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
          env: dependency.env.clone(),
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
          Self::on_undeferred(
            &mut self.request_id_to_dep_node_index,
            &mut self.work_count,
            &mut self.request_context,
            &self.sender,
            dependency_node_index,
            dependency,
          );
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

  fn handle_entry_result(&mut self, result: EntryRequestOutput) {
    let EntryRequestOutput { entries } = result;
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

  fn handle_asset_result(&mut self, result: AssetRequestOutput, request_id: u64) {
    let AssetRequestOutput {
      asset,
      dependencies,
    } = result;
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
        .add_dependency(asset_node_index, dependency.clone());
    }

    self.graph.propagate_requested_symbols(
      asset_node_index,
      incoming_dep_node_index,
      &mut |dependency_node_index: NodeIndex, dependency: Arc<Dependency>| {
        Self::on_undeferred(
          &mut self.request_id_to_dep_node_index,
          &mut self.work_count,
          &mut self.request_context,
          &self.sender,
          dependency_node_index,
          dependency,
        );
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
            Self::on_undeferred(
              &mut self.request_id_to_dep_node_index,
              &mut self.work_count,
              &mut self.request_context,
              &self.sender,
              dependency_node_index,
              dependency,
            );
          },
        );
      }
    }
  }

  fn handle_target_request_result(&mut self, result: TargetRequestOutput) {
    let TargetRequestOutput { entry, targets } = result;
    for target in targets {
      let entry =
        diff_paths(&entry, &self.request_context.project_root).unwrap_or_else(|| entry.clone());

      let dependency = Dependency::entry(entry.to_str().unwrap().to_string(), target);

      let dep_node = self.graph.add_entry_dependency(dependency.clone());

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

  /// When we find dependencies, we will only trigger resolution and parsing for dependencies
  /// that have used symbols.
  ///
  /// Once they do have symbols in use, this callback will re-trigger resolution/transformation
  /// for those files.
  fn on_undeferred(
    request_id_to_dep_node_index: &mut HashMap<u64, NodeIndex>,
    work_count: &mut u32,
    request_context: &mut RunRequestContext,
    sender: &ResultSender,
    dependency_node_index: NodeIndex,
    dependency: Arc<Dependency>,
  ) {
    let request = PathRequest {
      dependency: dependency.clone(),
    };

    request_id_to_dep_node_index.insert(request.id(), dependency_node_index);
    tracing::debug!(
      "queueing a path request from on_undeferred, {}",
      dependency.specifier
    );
    *work_count += 1;
    let _ = request_context.queue_request(request, sender.clone());
  }
}

#[cfg(test)]
mod test {
  use std::path::{Path, PathBuf};
  use std::sync::Arc;

  use tracing::Level;

  use parcel_core::types::Code;
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use parcel_filesystem::FileSystem;

  use crate::requests::{AssetGraphRequest, RequestResult};
  use crate::test_utils::{request_tracker, RequestTrackerTestOptions};

  #[test]
  fn test_asset_graph_request_with_no_entries() {
    let options = RequestTrackerTestOptions::default();
    let mut request_tracker = request_tracker(options);

    let asset_graph_request = AssetGraphRequest {};
    let RequestResult::AssetGraph(asset_graph_request_result) =
      request_tracker.run_request(asset_graph_request).unwrap()
    else {
      assert!(false, "Got invalid result");
      return;
    };

    assert_eq!(asset_graph_request_result.graph.assets.len(), 0);
    assert_eq!(asset_graph_request_result.graph.dependencies.len(), 0);
  }

  #[test]
  fn test_asset_graph_request_with_a_single_entry_with_no_dependencies() {
    let _ = tracing_subscriber::FmtSubscriber::builder()
      .with_max_level(Level::DEBUG)
      .try_init();

    let mut options = RequestTrackerTestOptions::default();
    let fs = InMemoryFileSystem::default();
    #[cfg(not(target_os = "windows"))]
    let temporary_dir = PathBuf::from("/parcel_tests");
    #[cfg(target_os = "windows")]
    let temporary_dir = PathBuf::from("c:/windows/parcel_tests");
    assert!(temporary_dir.is_absolute());
    fs.create_directory(&temporary_dir).unwrap();
    fs.set_current_working_directory(&temporary_dir); // <- resolver is broken without this
    options
      .parcel_options
      .entries
      .push(temporary_dir.join("entry.js").to_str().unwrap().to_string());
    options.project_root = temporary_dir.clone();
    options.search_path = temporary_dir.clone();
    fs.write_file(
      &temporary_dir.join("entry.js"),
      String::from(
        r#"
console.log('hello world');
        "#,
      ),
    );
    options.fs = Arc::new(fs);

    let mut request_tracker = request_tracker(options);

    let asset_graph_request = AssetGraphRequest {};
    let RequestResult::AssetGraph(asset_graph_request_result) = request_tracker
      .run_request(asset_graph_request)
      .expect("Failed to run asset graph request")
    else {
      assert!(false, "Got invalid result");
      return;
    };

    assert_eq!(asset_graph_request_result.graph.assets.len(), 1);
    assert_eq!(asset_graph_request_result.graph.dependencies.len(), 1);
    assert_eq!(
      asset_graph_request_result
        .graph
        .assets
        .get(0)
        .unwrap()
        .asset
        .file_path,
      temporary_dir.join("entry.js")
    );
    assert_eq!(
      asset_graph_request_result
        .graph
        .assets
        .get(0)
        .unwrap()
        .asset
        .code,
      Arc::new(Code::from(
        String::from(
          r#"
console.log('hello world');
        "#
        )
        .trim_start()
        .trim_end_matches(|p| p == ' ')
        .to_string()
      ))
    );
  }

  #[test]
  fn test_asset_graph_request_with_a_couple_of_entries() {
    let _ = tracing_subscriber::FmtSubscriber::builder()
      .with_max_level(Level::TRACE)
      .try_init();

    let mut options = RequestTrackerTestOptions::default();
    let fs = InMemoryFileSystem::default();
    #[cfg(not(target_os = "windows"))]
    let temporary_dir = PathBuf::from("/parcel_tests");
    #[cfg(target_os = "windows")]
    let temporary_dir = PathBuf::from("C:\\windows\\parcel_tests");
    fs.create_directory(&temporary_dir).unwrap();
    fs.set_current_working_directory(&temporary_dir); // <- resolver is broken without this
    options
      .parcel_options
      .entries
      .push(temporary_dir.join("entry.js").to_str().unwrap().to_string());
    options.project_root = temporary_dir.clone();
    options.search_path = temporary_dir.clone();
    options.parcel_options.core_path = temporary_dir.clone().join("parcel_core");
    fs.write_file(
      &temporary_dir.join("entry.js"),
      String::from(
        r#"
import {x} from './a';
import {y} from './b';
console.log(x + y);
        "#,
      ),
    );
    fs.write_file(
      &temporary_dir.join("a.js"),
      String::from(
        r#"
export const x = 15;
        "#,
      ),
    );
    fs.write_file(
      &temporary_dir.join("b.js"),
      String::from(
        r#"
export const y = 27;
        "#,
      ),
    );
    setup_core_modules(&fs, &options.parcel_options.core_path);
    options.fs = Arc::new(fs);

    let mut request_tracker = request_tracker(options);

    let asset_graph_request = AssetGraphRequest {};
    let RequestResult::AssetGraph(asset_graph_request_result) = request_tracker
      .run_request(asset_graph_request)
      .expect("Failed to run asset graph request")
    else {
      assert!(false, "Got invalid result");
      return;
    };

    // Entry, 2 assets + helpers file
    assert_eq!(asset_graph_request_result.graph.assets.len(), 4);
    // Entry, entry to assets (2), assets to helpers (2)
    assert_eq!(asset_graph_request_result.graph.dependencies.len(), 5);

    assert_eq!(
      asset_graph_request_result
        .graph
        .assets
        .get(0)
        .unwrap()
        .asset
        .file_path,
      temporary_dir.join("entry.js")
    );
  }

  fn setup_core_modules(fs: &InMemoryFileSystem, core_path: &Path) {
    let transformer_path = core_path
      .join("node_modules")
      .join("@parcel/transformer-js");
    let source_path = transformer_path.join("src");
    fs.create_directory(&source_path).unwrap();
    fs.write_file(&transformer_path.join("package.json"), String::from("{}"));
    fs.write_file(
      &source_path.join("esmodule-helpers.js"),
      String::from("/* helpers */"),
    );
  }
}
