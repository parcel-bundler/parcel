use crate::request_tracker::requests::asset_request::AssetRequestResult;
use crate::types::Asset;
use crate::worker_farm::WorkerFarm;

pub type TransformerResult = AssetRequestResult;

pub trait Transformer {
  fn transform(&self, asset: &Asset, code: Vec<u8>, farm: &WorkerFarm) -> AssetRequestResult;
}
