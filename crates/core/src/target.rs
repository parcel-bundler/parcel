use std::{path::PathBuf, sync::Arc};

use crate::{
  Engines, Environment, EnvironmentContext, IncludeNodeModules, OutputFormat, SourceLocation,
  SourceUrl, TargetSourceMapOptions,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  pub name: String,
  pub dist_entry: Option<String>,
  pub dist_dir: SourceUrl,
  pub env: Arc<Environment>,
  pub public_url: String,
  pub loc: Option<SourceLocation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageTargetDescriptor {
  context: Option<EnvironmentContext>,
  engines: Option<Engines>,
  include_node_modules: Option<IncludeNodeModules>,
  output_format: Option<OutputFormat>,
  public_url: Option<String>,
  dist_dir: Option<PathBuf>,
  source_map: Option<TargetSourceMapOptions>, // TODO: boolean
  is_library: Option<bool>,
  optimize: Option<bool>,
  scope_hoist: Option<bool>,
  source: Option<SourceField>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SourceField {
  Single(String),
  Multiple(Vec<String>),
}
