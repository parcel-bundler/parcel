use std::hash::Hash;
use std::path::PathBuf;

#[derive(Clone, Debug, Hash, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNode {
  pub package_name: String,
  pub resolve_from: PathBuf,
  pub key_path: Option<String>,
}
