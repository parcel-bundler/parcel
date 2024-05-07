use serde::Deserialize;
use serde::Serialize;

use super::AssetType;
use super::BundleBehavior;
use super::BundleFlags;
use super::Target;
use crate::environment::Environment;

#[derive(Clone, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
  pub id: String,
  pub public_id: Option<String>,
  pub hash_reference: String,
  #[serde(rename = "type")]
  pub bundle_type: AssetType,
  pub env: Environment,
  pub entry_asset_ids: Vec<String>,
  pub main_entry_id: Option<String>,
  pub flags: BundleFlags,
  pub bundle_behavior: BundleBehavior,
  pub target: Target,
  pub name: Option<String>,
  pub pipeline: Option<String>,
  pub manual_shared_bundle: Option<String>,
}
