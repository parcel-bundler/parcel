use crate::types::Asset;
use crate::types::Dependency;

#[derive(Clone, Debug, serde::Deserialize)]
pub struct AssetRequestResult {
  pub asset: Asset,
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub dependencies: Vec<Dependency>,
}
