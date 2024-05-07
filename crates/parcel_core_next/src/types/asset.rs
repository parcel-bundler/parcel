use std::collections::hash_map::DefaultHasher;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;

use super::AssetFlags;
use super::AssetStats;
use super::AssetType;
use super::BundleBehavior;
use super::JSONObject;
use super::Symbol;
use crate::environment::Environment;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  pub file_path: PathBuf,
  pub env: Environment,
  pub query: Option<String>,
  #[serde(rename = "type")]
  pub asset_type: AssetType,
  pub content_key: String,
  pub map_key: Option<String>,
  pub output_hash: String,
  pub pipeline: Option<String>,
  pub meta: JSONObject,
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: Vec<Symbol>,
  pub unique_key: Option<String>,
}

impl Asset {
  pub fn id(&self) -> u64 {
    use std::hash::Hash;
    use std::hash::Hasher;
    let mut hasher = DefaultHasher::new();
    self.file_path.hash(&mut hasher);
    self.asset_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.unique_key.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.query.hash(&mut hasher);
    hasher.finish()
  }
}
