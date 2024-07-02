use crate::{
  diagnostic::Diagnostic,
  parcel_config::PluginNode,
  requests::asset_request::{Transformer, TransformerResult},
  transformers::plugin_transformer::PluginTransformer,
  types::{Asset, ParcelOptions},
  worker_farm::WorkerFarm,
};

mod css_transformer;
mod js_transformer;
pub mod plugin_transformer;

pub fn run_transformer(
  plugin: &PluginNode,
  asset: Asset,
  code: Vec<u8>,
  farm: &WorkerFarm,
  options: &ParcelOptions,
) -> Result<TransformerResult, Vec<Diagnostic>> {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => {
      js_transformer::JsTransformer {}.transform(asset, code, farm, options)
    }
    "@parcel/transformer-css" => {
      css_transformer::CssTransformer {}.transform(asset, code, farm, options)
    }
    _ => {
      let transformer = PluginTransformer {
        plugin: plugin.clone(),
      };
      transformer.transform(asset, code, farm, options)
    }
  }
}
