use std::{
  collections::HashMap,
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
  FileName,
  FilePath,
  Glob,
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
  output: Option<Result<RequestOutput, Vec<Diagnostic>>>,
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

#[derive(PartialEq, Debug)]
enum RequestNodeState {
  Incomplete,
  Invalid,
  Error,
  Valid,
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

#[derive(Debug, PartialEq)]
enum RequestEdgeType {
  SubRequest,
  InvalidatedByUpdate,
  InvalidatedByDelete,
  InvalidatedByCreate,
  InvalidateByCreateAbove {
    dir: Option<Interned<PathBuf>>,
    above: Interned<PathBuf>,
  },
  Dirname,
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", content = "path")]
pub enum FileEvent {
  Create(PathBuf),
  Update(PathBuf),
  Delete(PathBuf),
}

#[derive(Debug)]
pub struct RequestTracker {
  graph: DiGraph<RequestGraphNode, RequestEdgeType>,
  requests: HashMap<u64, RequestNode>,
  file_names: HashMap<&'static str, NodeIndex>,
  file_paths: HashMap<&'static Path, NodeIndex>,
  globs: HashMap<&'static str, NodeIndex>,
}

impl RequestTracker {
  pub fn new() -> Self {
    RequestTracker {
      graph: DiGraph::new(),
      requests: HashMap::new(),
      file_names: HashMap::new(),
      file_paths: HashMap::new(),
      globs: HashMap::new(),
    }
  }

  pub fn start_request<R: Request>(&mut self, request: &R) -> bool {
    let id = request.id();
    let request = self.requests.entry(id).or_insert_with(|| {
      let node = self.graph.add_node(RequestGraphNode::Request(id));
      RequestNode {
        node,
        state: RequestNodeState::Incomplete,
        output: None,
      }
    });

    if request.state == RequestNodeState::Valid {
      return false;
    }

    request.state = RequestNodeState::Incomplete;
    request.output = None;

    // TODO: clear invalidations

    true
  }

  pub fn finish_request(
    &mut self,
    id: u64,
    result: Result<RequestOutput, Vec<Diagnostic>>,
    invalidations: Vec<Invalidation>,
  ) {
    let request = self.requests.get_mut(&id).unwrap();
    if request.state == RequestNodeState::Valid {
      return;
    }
    request.state = match result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    request.output = Some(result);

    let node = request.node;
    for invalidation in invalidations {
      match invalidation {
        Invalidation::InvalidateOnFileCreate(path) => {
          self.invalidate_on_file_event(node, path, RequestEdgeType::InvalidatedByCreate);
        }
        Invalidation::InvalidateOnFileCreateAbove { file_name, above } => {
          self.invalidate_on_file_create_above(node, &file_name, above)
        }
        Invalidation::InvalidateOnGlobCreate(glob) => {
          self.invalidate_on_glob_event(node, glob, RequestEdgeType::InvalidatedByCreate);
        }
        Invalidation::InvalidateOnFileUpdate(path) => {
          self.invalidate_on_file_event(node, path, RequestEdgeType::InvalidatedByUpdate);
        }
        Invalidation::InvalidateOnFileDelete(path) => {
          self.invalidate_on_file_event(node, path, RequestEdgeType::InvalidatedByDelete);
        }
      }
    }
  }

  pub fn get_request_result<R: Request + StoreRequestOutput>(
    &self,
    request: &R,
  ) -> &Result<RequestOutput, Vec<Diagnostic>> {
    let request = self.get_request(request);
    request.output.as_ref().unwrap()
  }

  fn has_valid_result<R: Request>(&self, request: &R) -> bool {
    let id = request.id();
    if let Some(req) = self.requests.get(&id) {
      return req.state == RequestNodeState::Valid;
    }

    false
  }

  fn get_request<R: Request>(&self, request: &R) -> &RequestNode {
    let id = request.id();
    self.requests.get(&id).unwrap()
  }

  fn get_request_mut<R: Request>(&mut self, request: &R) -> &mut RequestNode {
    let id = request.id();
    self.requests.get_mut(&id).unwrap()
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
      .or_insert_with(|| self.graph.add_node(RequestGraphNode::FilePath));

    self.graph.add_edge(*file_name_node, request_node, kind);
  }

  fn invalidate_on_file_create_above(
    &mut self,
    request_node: NodeIndex,
    pattern: &str,
    above: Interned<PathBuf>,
  ) {
    let (dir, name) = pattern.rsplit_once('/').unwrap_or(("", pattern));
    let name: Interned<String> = name.into();
    let file_name_node = self
      .file_names
      .entry(Interned::data(&name).as_str())
      .or_insert_with(|| self.graph.add_node(RequestGraphNode::FileName));

    self.graph.add_edge(
      *file_name_node,
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
      .or_insert_with(|| self.graph.add_node(RequestGraphNode::Glob));

    self.graph.add_edge(*glob_node, request_node, kind);
  }

  pub fn respond_to_fs_events(&mut self, events: Vec<FileEvent>) {
    for event in events {
      self.respond_to_fs_event(event)
    }
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

    assert!(tracker.has_valid_result(&request));

    // other files don't invalidate
    tracker.respond_to_fs_event(FileEvent::Update("foo/yo".into()));
    assert!(tracker.has_valid_result(&request));

    tracker.respond_to_fs_event(FileEvent::Update("foo/bar".into()));
    assert!(!tracker.has_valid_result(&request));
  }

  #[test]
  fn test_file_create() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    assert!(tracker.has_valid_result(&request));

    // other files don't invalidate
    tracker.respond_to_fs_event(FileEvent::Create("foo/yo".into()));
    assert!(tracker.has_valid_result(&request));

    tracker.respond_to_fs_event(FileEvent::Create("foo/create".into()));
    assert!(!tracker.has_valid_result(&request));
  }

  #[test]
  fn test_file_create_above() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    assert!(tracker.has_valid_result(&request));

    // other files don't invalidate
    tracker.respond_to_fs_event(FileEvent::Create("node_modules/bar".into()));
    assert!(tracker.has_valid_result(&request));

    // deeper files don't invalidate
    tracker.respond_to_fs_event(FileEvent::Create("foo/bar/baz/node_modules/foo".into()));
    assert!(tracker.has_valid_result(&request));

    // files outside subtree don't invalidate
    tracker.respond_to_fs_event(FileEvent::Create("baz/node_modules/foo".into()));
    assert!(tracker.has_valid_result(&request));

    tracker.respond_to_fs_event(FileEvent::Create("foo/node_modules/foo".into()));
    assert!(!tracker.has_valid_result(&request));
  }

  #[test]
  fn test_glob() {
    let mut tracker = RequestTracker::new();
    let request = run_request(&mut tracker);

    assert!(tracker.has_valid_result(&request));

    // non-matching files don't invalidate
    tracker.respond_to_fs_event(FileEvent::Create("foo/test".into()));
    assert!(tracker.has_valid_result(&request));

    tracker.respond_to_fs_event(FileEvent::Create("test/hi/bar/yo/foo".into()));
    assert!(!tracker.has_valid_result(&request));
  }
}
