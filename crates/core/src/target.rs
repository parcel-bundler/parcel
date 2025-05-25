use std::{path::PathBuf, sync::Arc};

use crate::{
  Engines, Environment, EnvironmentContext, IncludeNodeModules, OutputFormat, SourceLocation,
  TargetSourceMapOptions,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  name: String,
  dist_entry: Option<PathBuf>,
  dist_dir: PathBuf,
  env: Arc<Environment>,
  public_url: String,
  loc: Option<SourceLocation>,
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
