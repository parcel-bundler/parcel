use std::{
  collections::{hash_map::DefaultHasher, HashMap},
  hash::{Hash, Hasher},
};

use crate::requests::{
  asset_request::AssetRequest, bundle_graph_request::BundleGraphRequest,
  entry_request::EntryRequest, parcel_config_request::ParcelConfigRequest,
  path_request::PathRequest, target_request::TargetRequest,
};
use crate::worker_farm::WorkerFarm;
use petgraph::graph::{DiGraph, NodeIndex};
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};

pub trait Request: Hash + Sync {
  type Output: Send + Clone;

  fn id(&self) -> u64 {
    let mut hasher = DefaultHasher::new();
    std::any::type_name::<Self>().hash(&mut hasher); // ???
    self.hash(&mut hasher);
    hasher.finish()
  }

  fn run(&self, farm: &WorkerFarm) -> RequestResult<Self::Output>;
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

#[derive(Debug)]
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
  farm: WorkerFarm,
}

impl RequestTracker {
  pub fn new(farm: WorkerFarm) -> Self {
    RequestTracker {
      graph: DiGraph::new(),
      requests: HashMap::new(),
      farm,
    }
  }

  fn start_request<R: Request>(&mut self, request: &R) -> bool {
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

  fn get_request<R: Request>(&mut self, request: &R) -> &RequestNode {
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

  /// Runs multiple requests in parallel.
  pub fn run_requests<R: Request + StoreRequestOutput>(
    &mut self,
    requests: Vec<R>,
  ) -> Vec<Result<R::Output, RequestError>> {
    // First, find the requests we actually need to run, and add them to the graph if needed.
    let nodes_to_run: Vec<_> = requests
      .iter()
      .map(|request| {
        if self.start_request(request) {
          Some(request)
        } else {
          None
        }
      })
      .collect();

    // Now, run the requests in parallel.
    let results: Vec<_> = nodes_to_run
      .par_iter()
      .map(|request| {
        if let Some(request) = request {
          Some(request.run(&self.farm))
        } else {
          None
        }
      })
      .collect();

    // Finally, update the graph and collect the results for all requests, even ones we didn't re-run.
    requests
      .iter()
      .zip(results)
      .map(|(request, result)| {
        let request = self.get_request_mut(request);
        if let Some(result) = result {
          request.state = match result.result {
            Ok(_) => RequestNodeState::Valid,
            Err(_) => RequestNodeState::Error,
          };

          request.output = Some(
            result
              .result
              .clone()
              .map(|result| <R as StoreRequestOutput>::store(result)),
          );

          result.result
        } else if let Some(output) = &request.output {
          let res = output
            .as_ref()
            .map(|output| <R as StoreRequestOutput>::retrieve(output));
          match res {
            Ok(r) => Ok(r.clone()),
            Err(e) => Err(e.clone()),
          }
        } else {
          unreachable!()
        }

        // TODO: insert invalidations
        // TODO: remove old sub-requests
      })
      .collect()
  }

  /// Runs a single request on the current thread.
  pub fn run_request<R: Request + StoreRequestOutput>(
    &mut self,
    request: R,
  ) -> Result<R::Output, RequestError> {
    if !self.start_request(&request) {
      let request = self.get_request(&request);
      let res = request
        .output
        .as_ref()
        .unwrap()
        .as_ref()
        .map(|output| <R as StoreRequestOutput>::retrieve(output));
      return match res {
        Ok(r) => Ok(r.clone()),
        Err(e) => Err(e.clone()),
      };
    }

    let result = request.run(&self.farm);

    let request = self.get_request_mut(&request);
    request.state = match result.result {
      Ok(_) => RequestNodeState::Valid,
      Err(_) => RequestNodeState::Error,
    };

    // TODO: insert invalidations

    request.output = Some(
      result
        .result
        .clone()
        .map(|result| <R as StoreRequestOutput>::store(result)),
    );

    result.result
  }
}
