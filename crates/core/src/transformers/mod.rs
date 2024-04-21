use crate::{
  parcel_config::PluginNode,
  requests::asset_request::{AssetRequestResult, Transformer},
  transformers::plugin_transformer::PluginTransformer,
  types::Asset,
  worker_farm::WorkerFarm,
};

mod js_transformer;
pub mod plugin_transformer;

pub fn run_transformer(
  plugin: PluginNode,
  asset: &Asset,
  code: Vec<u8>,
  farm: &WorkerFarm,
) -> AssetRequestResult {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => js_transformer::JsTransformer {}.transform(asset, code, farm),
    _ => {
      let transformer = PluginTransformer { plugin };
      transformer.transform(asset, code, farm)
    }
  }
}
