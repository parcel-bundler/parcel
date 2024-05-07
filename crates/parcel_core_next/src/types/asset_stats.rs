use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AssetStats {
  pub size: u32,
  pub time: u32,
}
