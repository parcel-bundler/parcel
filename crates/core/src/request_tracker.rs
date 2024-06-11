use std::{
  collections::{hash_map::Entry, HashMap},
  hash::{Hash, Hasher},
  path::{Path, PathBuf},
};

use crate::{diagnostic::Diagnostic, intern::Interned, worker_farm::WorkerFarm};
use crate::{
  requests::{
    asset_request::AssetRequest, bundle_graph_request::BundleGraphRequest,
    entry_request::EntryRequest, parcel_config_request::ParcelConfigRequest,
    path_request::PathRequest, target_request::TargetRequest,
  },
  types::ParcelOptions,
};
use glob_match::glob_match;
use gxhash::GxHasher;
use petgraph::{
  graph::{DiGraph, NodeIndex},
  visit::EdgeRef,
  Direction,
};

pub trait Request: Hash + Sync {
  type Output: Send + Clone;

  fn id(&self) -> u64 {
    let mut hasher = GxHasher::default();
    std::any::type_name::<Self>().hash(&mut hasher); // ???
    self.hash(&mut hasher);
    hasher.finish()
  }

  fn run(self, farm: &WorkerFarm, options: &ParcelOptions) -> RequestResult<Self::Output>;
}

pub struct RequestResult<Output> {
  pub result: Result<Output, Vec<Diagnostic>>,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Debug)]
enum RequestGraphNode {
  FileName(Interned<String>),
  FilePath(Interned<PathBuf>),
  Glob(Interned<String>),
  Option,
  ConfigKey,
  Request(u64),
}

#[derive(Debug, Clone)]
pub enum RequestOutput {
  ParcelBuildRequest,
  BundleGraphRequest(<BundleGraphRequest as Request>::Output),
  AssetGraphRequest,
  EntryRequest(<EntryRequest as Request>::Output),
  TargetRequest(<TargetRequest as Request>::Output),
  ParcelConfigRequest(<ParcelConfigRequest as Request>::Output),
  PathRequest(<PathRequest<'static> as Request>::Output),
  DevDepRequest,
  AssetRequest(<AssetRequest<'static> as Request>::Output),
  ConfigRequest,
  WriteBundlesRequest,
  PackageRequest,
  WriteBundleRequest,
  ValidationRequest,
}

#[derive(Debug)]
struct RequestNode {
  node: NodeIndex,
  state: RequestNodeState,
}

pub trait StoreRequestOutput: Request {
  fn store(output: Self::Output) -> RequestOutput;
  fn retrieve(output: &RequestOutput) -> &Self::Output;
}

macro_rules! impl_store_request {
  ($t: ident $(<$l: lifetime>)?) => {
    impl $(<$l>)? StoreRequestOutput for $t $(<$l>)? {
      fn store(output: Self::Output) -> RequestOutput {
        RequestOutput::$t(output)
      }

      fn retrieve(output: &RequestOutput) -> &Self::Output {
        match output {
          RequestOutput::$t(res) => res,
          _ => unreachable!("unexpected request result"),
        }
      }
    }
  };
}

impl_store_request!(ParcelConfigRequest);
impl_store_request!(EntryRequest);
impl_store_request!(TargetRequest);
impl_store_request!(PathRequest<'a>);
impl_store_request!(AssetRequest<'a>);
impl_store_request!(BundleGraphRequest);

#[derive(Debug)]
enum RequestNodeState {
  Incomplete,
  Invalid,
  Error(Vec<Diagnostic>),
  Valid(RequestOutput),
}

pub enum Invalidation {
  InvalidateOnFileCreate(Interned<PathBuf>),
  InvalidateOnFileCreateAbove {
    file_name: String,
    above: Interned<PathBuf>,
  },
  InvalidateOnGlobCreate(Interned<String>),
  InvalidateOnFileUpdate(Interned<PathBuf>),
  InvalidateOnFileDelete(Interned<PathBuf>),
}

#[derive(Debug, PartialEq, Clone)]
enum RequestEdgeType {
  InvalidatedByUpdate,
  InvalidatedByDelete,
  InvalidatedByCreate,
  InvalidateByCreateAbove {
    dir: Option<Interned<PathBuf>>,
    above: Interned<PathBuf>,
  },
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", content = "path")]
pub enum FileEvent {
  Create(PathBuf),
  Update(PathBuf),
  Delete(PathBuf),
}

/// A RequestTracker is a builder for a RequestGraph.
/// The RequestGraph is not mutated once a build is complete.
/// When file system events occur, nodes are invalidated in the previous RequestGraph.
/// Then, a new RequestGraph is created for the next build. As requests are run,
/// valid results can be reused from the previous build.
#[derive(Default)]
pub struct RequestTracker {
  prev: RequestGraph,
  graph: RequestGraph,
}

#[derive(Default)]
struct RequestGraph {
  graph: DiGraph<RequestGraphNode, RequestEdgeType>,
  requests: HashMap<u64, RequestNode>,
  file_names: HashMap<&'static str, NodeIndex>,
  file_paths: HashMap<&'static Path, NodeIndex>,
  globs: HashMap<&'static str, NodeIndex>,
}

impl RequestTracker {
  pub fn new() -> Self {
    RequestTracker::default()
  }

  pub fn next_build(&mut self, events: Vec<FileEvent>) {
    // Invalidate nodes in the current graph, and create a new one for the next build.
    // TODO: possibly could be faster if we didn't move the whole graph in memory. Could just swap between them.
    self.prev = std::mem::take(&mut self.graph);
    for event in events {
      self.prev.respond_to_fs_event(event);
    }
  }

  pub fn start_request<R: Request>(&mut self, request: &R) -> Option<RequestOutput> {
    let id = request.id();
    let request = match self.graph.requests.entry(id) {
      Entry::Occupied(entry) => entry.into_mut(),
      Entry::Vacant(entry) => {
        let node = self.graph.graph.add_node(RequestGraphNode::Request(id));

        // Check if we have a valid result from a previous build.
        if let Some(prev_request) = self.prev.requests.get(&id) {
          if let RequestNodeState::Valid(res) = &prev_request.state {
            entry.insert(RequestNode {
              node,
              state: RequestNodeState::Valid(res.clone()),
            });
            self
              .prev
              .copy_invalidations(prev_request.node, &mut self.graph, node);
            return Some(res.clone());
          }
        }

        entry.insert(RequestNode {
          node,
          state: RequestNodeState::Incomplete,
        })
      }
    };

    if let RequestNodeState::Valid(res) = &request.state {
      return Some(res.clone());
    }

    request.state = RequestNodeState::Incomplete;
    None
  }

  pub fn finish_request(
    &mut self,
    id: u64,
    result: Result<RequestOutput, Vec<Diagnostic>>,
    invalidations: Vec<Invalidation>,
  ) {
    let request = self.graph.requests.get_mut(&id).unwrap();
    if matches!(request.state, RequestNodeState::Valid(_)) {
      return;
    }
    request.state = match result {
      Ok(res) => RequestNodeState::Valid(res),
      Err(err) => RequestNodeState::Error(err),
    };

    let node = request.node;
    for invalidation in invalidations {
      match invalidation {
        Invalidation::InvalidateOnFileCreate(path) => {
          self
            .graph
            .invalidate_on_file_event(node, path, RequestEdgeType::InvalidatedByCreate);
        }
        Invalidation::InvalidateOnFileCreateAbove { file_name, above } => self
          .graph
          .invalidate_on_file_create_above(node, &file_name, above),
        Invalidation::InvalidateOnGlobCreate(glob) => {
          self
            .graph
            .invalidate_on_glob_event(node, glob, RequestEdgeType::InvalidatedByCreate);
        }
        Invalidation::InvalidateOnFileUpdate(path) => {
          self
            .graph
            .invalidate_on_file_event(node, path, RequestEdgeType::InvalidatedByUpdate);
        }
        Invalidation::InvalidateOnFileDelete(path) => {
          self
            .graph
            .invalidate_on_file_event(node, path, RequestEdgeType::InvalidatedByDelete);
        }
      }
    }
  }

  pub fn build_success(&mut self) {
    // After a successful build, drop the previous RequestGraph to free up memory.
    self.prev = RequestGraph::default();
  }
}

impl RequestGraph {
  fn copy_invalidations(&self, from_node: NodeIndex, dest: &mut RequestGraph, to_node: NodeIndex) {
    for edge in self.graph.edges_directed(from_node, Direction::Incoming) {
      let target = &self.graph[edge.source()];
      match (edge.weight(), target) {
        (
          kind @ (RequestEdgeType::InvalidatedByCreate
          | RequestEdgeType::InvalidatedByUpdate
          | RequestEdgeType::InvalidatedByDelete),
          RequestGraphNode::FilePath(path),
        ) => {
          dest.invalidate_on_file_event(to_node, path.clone(), kind.clone());
        }
        (
          kind @ (RequestEdgeType::InvalidatedByCreate
          | RequestEdgeType::InvalidatedByUpdate
          | RequestEdgeType::InvalidatedByDelete),
          RequestGraphNode::Glob(glob),
        ) => {
          dest.invalidate_on_glob_event(to_node, glob.clone(), kind.clone());
        }
        (
          weight @ RequestEdgeType::InvalidateByCreateAbove { .. },
          RequestGraphNode::FileName(name),
        ) => {
          let file_name_node = dest.get_file_name_node(name);
          dest.graph.add_edge(file_name_node, to_node, weight.clone());
        }
        _ => unreachable!("unexpected graph structure"),
      }
    }
  }

  fn has_valid_result<R: Request>(&self, request: &R) -> bool {
    let id = request.id();
    if let Some(req) = self.requests.get(&id) {
      return matches!(req.state, RequestNodeState::Valid(_));
    }

    false
  }

  fn invalidate_on_file_event(
    &mut self,
    request_node: NodeIndex,
    path: Interned<PathBuf>,
    kind: RequestEdgeType,
  ) {
    let file_name_node = self
      .file_paths
      .entry(Interned::data(&path).as_path())
      .or_insert_with(|| self.graph.add_node(RequestGraphNode::FilePath(path)));

    self.graph.add_edge(*file_name_node, request_node, kind);
  }

  fn get_file_name_node(&mut self, name: &str) -> NodeIndex {
    let name: Interned<String> = name.into();
    let file_name_node = self
      .file_names
      .entry(Interned::data(&name).as_str())
      .or_insert_with(|| self.graph.add_node(RequestGraphNode::FileName(name)));

    *file_name_node
  }

  fn invalidate_on_file_create_above(
    &mut self,
    request_node: NodeIndex,
    pattern: &str,
    above: Interned<PathBuf>,
  ) {
    let (dir, name) = pattern.rsplit_once('/').unwrap_or(("", pattern));
    let file_name_node = self.get_file_name_node(name);

    self.graph.add_edge(
      file_name_node,
      request_node,
      RequestEdgeType::InvalidateByCreateAbove {
        dir: if dir.is_empty() {
          None
        } else {
          Some(dir.into())
        },
        above,
      },
    );
  }

  fn invalidate_on_glob_event(
    &mut self,
    request_node: NodeIndex,
    glob: Interned<String>,
    kind: RequestEdgeType,
  ) {
    let glob_node = self
      .globs
      .entry(Interned::data(&glob).as_str())
      .or_insert_with(|| self.graph.add_node(RequestGraphNode::Glob(glob)));

    self.graph.add_edge(*glob_node, request_node, kind);
  }

  fn respond_to_fs_event(&mut self, event: FileEvent) {
    match event {
      FileEvent::Create(path) => {
        if let Some(file_path_node) = self.file_paths.get(path.as_path()) {
          invalidate_file(
            &self.graph,
            &mut self.requests,
            *file_path_node,
            RequestEdgeType::InvalidatedByCreate,
          );
        }

        let file_name = path.file_name().unwrap().to_string_lossy();
        if let Some(file_name_node) = self.file_names.get(file_name.as_ref()) {
          self.invalidate_file_name(*file_name_node, &path);
        }

        let path_str = path.to_string_lossy();
        for (glob, node_index) in &self.globs {
          if glob_match(glob, path_str.as_ref()) {
            invalidate_file(
              &self.graph,
              &mut self.requests,
              *node_index,
              RequestEdgeType::InvalidatedByCreate,
            );
          }
        }
      }
      FileEvent::Update(path) => {
        if let Some(file_path_node) = self.file_paths.get(path.as_path()) {
          invalidate_file(
            &self.graph,
            &mut self.requests,
            *file_path_node,
            RequestEdgeType::InvalidatedByUpdate,
          );
        }
      }
      FileEvent::Delete(path) => {
        if let Some(file_path_node) = self.file_paths.get(path.as_path()) {
          invalidate_file(
            &self.graph,
            &mut self.requests,
            *file_path_node,
            RequestEdgeType::InvalidatedByDelete,
          );
        }
      }
    }
  }

  fn invalidate_file_name(&mut self, node: NodeIndex, path: &Path) {
    let parent = path.parent().unwrap();
    for edge in self.graph.edges_directed(node, Direction::Outgoing) {
      if let RequestEdgeType::InvalidateByCreateAbove { dir, above } = edge.weight() {
        if (dir.is_none() || parent.ends_with(dir.unwrap().as_path()))
          // new file is not deeper than the above path
          && !path.starts_with(above.as_path())
          // but is inside the root of the above path
          && path.starts_with(above.components().next().unwrap())
        {
          invalidate_request(&self.graph, &mut self.requests, edge.target());
        }
      }
    }
  }
}

fn invalidate_file(
  graph: &DiGraph<RequestGraphNode, RequestEdgeType>,
  requests: &mut HashMap<u64, RequestNode>,
  node: NodeIndex,
  kind: RequestEdgeType,
) {
  for edge in graph.edges_directed(node, Direction::Outgoing) {
    if *edge.weight() == kind {
      invalidate_request(&graph, requests, edge.target());
    }
  }
}

fn invalidate_request(
  graph: &DiGraph<RequestGraphNode, RequestEdgeType>,
  requests: &mut HashMap<u64, RequestNode>,
  node: NodeIndex,
) {
  let RequestGraphNode::Request(request_id) = graph[node] else {
    return;
  };

  let request = requests.get_mut(&request_id).unwrap();
  request.state = RequestNodeState::Invalid;

  for parent in graph.edges_directed(node, Direction::Incoming) {
    invalidate_request(graph, requests, parent.source());
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::requests::entry_request::Entry;

  fn run_request(tracker: &mut RequestTracker) -> EntryRequest {
    let request = EntryRequest {
      entry: "test".into(),
    };

    tracker.start_request(&request);
    tracker.finish_request(
      request.id(),
      Ok(RequestOutput::EntryRequest(vec![Entry {
        file_path: "test".into(),
        package_path: "".into(),
        target: None,
      }])),
      vec![
        Invalidation::InvalidateOnFileUpdate("foo/bar".into()),
        Invalidation::InvalidateOnFileCreate("foo/create".into()),
        Invalidation::InvalidateOnFileCreateAbove {
          file_name: "node_modules/foo".into(),
          above: "foo/bar".into(),
        },
        Invalidation::InvalidateOnGlobCreate("**/bar/*/foo".into()),
      ],
    );

    request
  }

  #[test]
  fn test_file_update() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    let graph = &mut tracker.graph;
    assert!(graph.has_valid_result(&request));

    // other files don't invalidate
    graph.respond_to_fs_event(FileEvent::Update("foo/yo".into()));
    assert!(graph.has_valid_result(&request));

    graph.respond_to_fs_event(FileEvent::Update("foo/bar".into()));
    assert!(!graph.has_valid_result(&request));
  }

  #[test]
  fn test_file_create() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    let graph = &mut tracker.graph;
    assert!(graph.has_valid_result(&request));

    // other files don't invalidate
    graph.respond_to_fs_event(FileEvent::Create("foo/yo".into()));
    assert!(graph.has_valid_result(&request));

    graph.respond_to_fs_event(FileEvent::Create("foo/create".into()));
    assert!(!graph.has_valid_result(&request));
  }

  #[test]
  fn test_file_create_above() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    let graph = &mut tracker.graph;
    assert!(graph.has_valid_result(&request));

    // other files don't invalidate
    graph.respond_to_fs_event(FileEvent::Create("node_modules/bar".into()));
    assert!(graph.has_valid_result(&request));

    // deeper files don't invalidate
    graph.respond_to_fs_event(FileEvent::Create("foo/bar/baz/node_modules/foo".into()));
    assert!(graph.has_valid_result(&request));

    // files outside subtree don't invalidate
    graph.respond_to_fs_event(FileEvent::Create("baz/node_modules/foo".into()));
    assert!(graph.has_valid_result(&request));

    graph.respond_to_fs_event(FileEvent::Create("foo/node_modules/foo".into()));
    assert!(!graph.has_valid_result(&request));
  }

  #[test]
  fn test_glob() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    let graph = &mut tracker.graph;
    assert!(graph.has_valid_result(&request));

    // non-matching files don't invalidate
    graph.respond_to_fs_event(FileEvent::Create("foo/test".into()));
    assert!(graph.has_valid_result(&request));

    graph.respond_to_fs_event(FileEvent::Create("test/hi/bar/yo/foo".into()));
    assert!(!graph.has_valid_result(&request));
  }

  #[test]
  fn test_next_build() {
    let mut tracker = RequestTracker::new();
    let request: EntryRequest = run_request(&mut tracker);

    let graph = &mut tracker.graph;
    assert!(graph.has_valid_result(&request));

    tracker.next_build(vec![]);
    assert!(!tracker.graph.has_valid_result(&request));

    assert!(tracker.start_request(&request).is_some());
    assert!(tracker.graph.has_valid_result(&request));

    tracker.next_build(vec![FileEvent::Update("foo/bar".into())]);
    assert!(tracker.start_request(&request).is_none());
  }
}
