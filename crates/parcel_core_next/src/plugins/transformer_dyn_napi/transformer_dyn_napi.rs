use super::PluginTransformRequest;
use crate::parcel_config::PluginNode;
use crate::plugins::Transformer;
use crate::plugins::TransformerResult;
use crate::types::Asset;
use crate::worker_farm::WorkerFarm;
use crate::worker_farm::WorkerRequest;
use crate::worker_farm::WorkerResult;

/// TransformerDynNapi is a proxy transformer that will delegate transformation
/// tasks to dynamically loaded transformers located in the JavaScript context
pub struct TransformerDynNapi {
  pub plugin: PluginNode,
}

impl Transformer for TransformerDynNapi {
  fn transform(&self, asset: &Asset, code: Vec<u8>, farm: &WorkerFarm) -> TransformerResult {
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
