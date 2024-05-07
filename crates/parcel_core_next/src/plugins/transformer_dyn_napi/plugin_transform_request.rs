use crate::parcel_config::PluginNode;
use crate::types::Asset;

#[derive(serde::Serialize, Debug)]
pub struct PluginTransformRequest {
  pub plugin: PluginNode,
  pub asset: Asset,
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
}
