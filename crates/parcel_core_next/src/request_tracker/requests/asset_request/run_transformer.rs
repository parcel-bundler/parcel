use crate::parcel_config::PluginNode;
use crate::plugins::transformer_dyn_napi::TransformerDynNapi;
use crate::plugins::transformer_js_default::TransformerJsDefault;
use crate::plugins::Transformer;
use crate::plugins::TransformerResult;
use crate::types::Asset;
use crate::worker_farm::WorkerFarm;

pub fn run_transformer(
  plugin: &PluginNode,
  asset: &Asset,
  code: Vec<u8>,
  farm: &WorkerFarm,
) -> TransformerResult {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => TransformerJsDefault {}.transform(asset, code, farm),
    _ => {
      let transformer = TransformerDynNapi {
        plugin: plugin.clone(),
      };
      transformer.transform(asset, code, farm)
    }
  }
}
