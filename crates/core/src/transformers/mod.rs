use crate::{
  parcel_config::PluginNode,
  requests::asset_request::{AssetRequestResult, Transformer},
  transformers::plugin_transformer::PluginTransformer,
  types::{Asset, ParcelOptions},
  worker_farm::WorkerFarm,
};

mod js_transformer;
pub mod plugin_transformer;

pub fn run_transformer(
  plugin: &PluginNode,
  asset: &Asset,
  code: Vec<u8>,
  farm: &WorkerFarm,
  options: &ParcelOptions,
) -> AssetRequestResult {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => {
      js_transformer::JsTransformer {}.transform(asset, code, farm, options)
    }
    _ => {
      let transformer = PluginTransformer {
        plugin: plugin.clone(),
      };
      transformer.transform(asset, code, farm, options)
    }
  }
}
