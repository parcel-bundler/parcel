use std::{
  collections::HashMap,
  hash::{Hash, Hasher},
};

use crate::worker_farm::WorkerFarm;
use crate::{
  requests::{
    asset_request::AssetRequest, bundle_graph_request::BundleGraphRequest,
    entry_request::EntryRequest, parcel_config_request::ParcelConfigRequest,
    path_request::PathRequest, target_request::TargetRequest,
  },
  types::ParcelOptions,
};
use gxhash::GxHasher;
use petgraph::graph::{DiGraph, NodeIndex};

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
  pub result: Result<Output, RequestError>,
  pub invalidations: Vec<Invalidation>,
}

#[derive(Clone, Debug)]
pub enum RequestError {}

#[derive(Debug)]
enum RequestGraphNode {
  FileName,
  Option,
  ConfigKey,
  Request(RequestNode),
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
  state: RequestNodeState,
  output: Option<Result<RequestOutput, RequestError>>,
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

pub enum Invalidation {}

#[derive(Debug)]
enum RequestEdgeType {
  SubRequest,
  InvalidatedByUpdate,
  InvalidatedByDelete,
  InvalidatedByCreate,
  InvalidateByCreateAbove,
  Dirname,
}

#[derive(Debug)]
pub struct RequestTracker {
  graph: DiGraph<RequestGraphNode, RequestEdgeType>,
  requests: HashMap<u64, NodeIndex>,
}

impl RequestTracker {
  pub fn new() -> Self {
    RequestTracker {
      graph: DiGraph::new(),
      requests: HashMap::new(),
    }
  }

  pub fn start_request<R: Request>(&mut self, request: &R) -> bool {
    let id = request.id();
    let index = self.requests.entry(id).or_insert_with(|| {
      self.graph.add_node(RequestGraphNode::Request(RequestNode {
        state: RequestNodeState::Incomplete,
        output: None,
      }))
    });

    let request = match self.graph.node_weight_mut(*index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    };

    if request.state == RequestNodeState::Valid {
      return false;
    }

    request.state = RequestNodeState::Incomplete;
    request.output = None;

    // TODO: clear invalidations

    true
  }

  pub fn finish_request(&mut self, id: u64, result: Result<RequestOutput, RequestError>) {
    let node_index = self.requests.get(&id).unwrap();
    let request = match self.graph.node_weight_mut(*node_index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    };
    if request.state == RequestNodeState::Valid {
      return;
    }
    request.state = match result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    request.output = Some(result);
  }

  pub fn get_request_result<R: Request + StoreRequestOutput>(
    &self,
    request: &R,
  ) -> &Result<RequestOutput, RequestError> {
    let request = self.get_request(request);
    request.output.as_ref().unwrap()
  }

  fn has_valid_result<R: Request>(&self, request: &R) -> bool {
    let id = request.id();
    if let Some(index) = self.requests.get(&id) {
      return match self.graph.node_weight(*index) {
        Some(RequestGraphNode::Request(req)) => req.state == RequestNodeState::Valid,
        _ => false,
      };
    }

    false
  }

  fn get_request<R: Request>(&self, request: &R) -> &RequestNode {
    let id = request.id();
    let node_index = self.requests.get(&id).unwrap();
    match self.graph.node_weight(*node_index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    }
  }

  fn get_request_mut<R: Request>(&mut self, request: &R) -> &mut RequestNode {
    let id = request.id();
    let node_index = self.requests.get(&id).unwrap();
    match self.graph.node_weight_mut(*node_index) {
      Some(RequestGraphNode::Request(req)) => req,
      _ => unreachable!("expected a request node"),
    }
  }
}
