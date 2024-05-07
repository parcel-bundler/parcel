use crate::parcel_config::PluginNode;
use crate::requests::asset_request::AssetRequestResult;
use crate::requests::asset_request::Transformer;
use crate::transformers::plugin_transformer::PluginTransformer;
use crate::types::Asset;
use crate::worker_farm::WorkerFarm;

mod js_transformer;
pub mod plugin_transformer;

pub fn run_transformer(
  plugin: &PluginNode,
  asset: &Asset,
  code: Vec<u8>,
  farm: &WorkerFarm,
) -> AssetRequestResult {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => js_transformer::JsTransformer {}.transform(asset, code, farm),
    _ => {
      let transformer = PluginTransformer {
        plugin: plugin.clone(),
      };
      transformer.transform(asset, code, farm)
    }
  }
}
