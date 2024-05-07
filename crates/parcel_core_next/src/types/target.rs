use serde::Deserialize;
use serde::Serialize;

use super::SourceLocation;
use crate::environment::Environment;

#[derive(Debug, Clone, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  pub env: Environment,
  pub dist_dir: String,
  pub dist_entry: Option<String>,
  pub name: String,
  pub public_url: String,
  pub loc: Option<SourceLocation>,
  pub pipeline: Option<String>,
  // source: Option<u32>
}
