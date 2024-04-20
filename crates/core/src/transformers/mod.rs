use crate::{
  parcel_config::PluginNode,
  requests::asset_request::{AssetRequestResult, Transformer},
  types::Asset,
};

mod js_transformer;

pub fn run_transformer(plugin: PluginNode, asset: &Asset) -> AssetRequestResult {
  match plugin.package_name.as_str() {
    "@parcel/transformer-js" => js_transformer::JsTransformer::transform(asset),
    _ => AssetRequestResult {
      asset: asset.clone(),
      dependencies: vec![],
    },
  }
}
