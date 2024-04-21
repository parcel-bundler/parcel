use crate::parcel_config::PluginNode;
use crate::requests::asset_request::{AssetRequestResult, Transformer};
use crate::types::Asset;
use crate::worker_farm::{WorkerFarm, WorkerRequest, WorkerResult};

pub struct PluginTransformer {
  pub plugin: PluginNode,
}

#[derive(serde::Serialize, Debug)]
pub struct PluginTransformRequest {
  plugin: PluginNode,
  asset: Asset,
  #[serde(with = "serde_bytes")]
  code: Vec<u8>,
}

impl Transformer for PluginTransformer {
  fn transform(&self, asset: &Asset, code: Vec<u8>, farm: &WorkerFarm) -> AssetRequestResult {
    let req = PluginTransformRequest {
      plugin: self.plugin.clone(),
      asset: asset.clone(),
      code,
    };

    let WorkerResult::Transform(result) = farm.run(WorkerRequest::Transform(req)).unwrap() else {
      unreachable!()
    };

    result
  }
}
