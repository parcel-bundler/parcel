use crate::{
  asset_graph::{AssetGraph, AssetGraphNode},
  parcel_config::PluginNode,
  request_tracker::{Request, RequestResult},
  types::{Bundle, BundleBehavior, ParcelOptions, Priority},
  worker_farm::{WorkerRequest, WorkerResult},
};

#[derive(Hash, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BundleGraphRequest {
  pub asset_graph: AssetGraph,
  pub bundler: PluginNode,
}

impl Request for BundleGraphRequest {
  type Output = Vec<Bundle>;

  fn run(
    &self,
    farm: &crate::worker_farm::WorkerFarm,
    options: &ParcelOptions,
  ) -> RequestResult<Self::Output> {
    let WorkerResult::BundleGraph(bundles) =
      farm.run(WorkerRequest::BundleGraph(self.clone())).unwrap()
    else {
      unreachable!()
    };

    RequestResult {
      result: Ok(bundles),
      invalidations: Vec::new(),
    }
  }
}
