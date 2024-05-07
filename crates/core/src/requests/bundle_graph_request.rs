use crate::asset_graph::AssetGraph;
use crate::parcel_config::PluginNode;
use crate::request_tracker::Request;
use crate::request_tracker::RequestResult;
use crate::types::Bundle;
use crate::worker_farm::WorkerRequest;
use crate::worker_farm::WorkerResult;

#[derive(Hash, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BundleGraphRequest {
  pub asset_graph: AssetGraph,
  pub bundler: PluginNode,
}

impl Request for BundleGraphRequest {
  type Output = Vec<Bundle>;

  fn run(&self, farm: &crate::worker_farm::WorkerFarm) -> RequestResult<Self::Output> {
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
