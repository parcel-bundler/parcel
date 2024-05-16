use std::path::PathBuf;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelConfig {
  pub bundler: PluginNode,
  pub compressors: IndexMap<String, Vec<PluginNodeEntry>>,
  pub namers: Vec<PluginNodeEntry>,
  pub optimizers: IndexMap<String, Vec<PluginNodeEntry>>,
  pub packagers: IndexMap<String, PluginNode>,
  pub reporters: Vec<PluginNodeEntry>,
  pub resolvers: Vec<PluginNodeEntry>,
  pub runtimes: Vec<PluginNodeEntry>,
  pub transformers: IndexMap<String, Vec<PluginNodeEntry>>,
  pub validators: IndexMap<String, Vec<PluginNodeEntry>>,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNode {
  package_name: String,
  resolve_from: PathBuf,
  key_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(untagged)]
pub enum PluginNodeEntry {
  PluginNode(PluginNode),
  String(String),
}
