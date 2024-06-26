use std::collections::HashMap;
use std::path::PathBuf;

use parcel_core::types::engines::Engines;
use parcel_core::types::Entry;
use parcel_core::types::EnvironmentContext;
use parcel_core::types::OutputFormat;
use parcel_core::types::TargetSourceMapOptions;
use parcel_resolver::IncludeNodeModules;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum BrowserField {
  EntryPoint(PathBuf),
  // TODO false value
  ReplacementBySpecifier(HashMap<String, PathBuf>),
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum BuiltInTargetDescriptor {
  Disabled(serde_bool::False),
  TargetDescriptor(TargetDescriptor),
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TargetDescriptor {
  pub context: Option<EnvironmentContext>,
  pub dist_dir: Option<PathBuf>,
  pub dist_entry: Option<PathBuf>,
  pub engines: Option<Engines>,
  pub include_node_modules: Option<IncludeNodeModules>,
  pub is_library: Option<bool>,
  pub optimize: Option<bool>,
  pub output_format: Option<OutputFormat>,
  pub public_url: Option<String>,
  pub scope_hoist: Option<bool>,
  pub source: Option<Entry>,
  pub source_map: Option<SourceMapField>,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum BrowsersList {
  Browsers(Vec<String>),
  BrowsersByEnv(HashMap<String, Vec<String>>),
}

#[derive(Default, Deserialize)]
pub struct TargetsField {
  pub browser: Option<BuiltInTargetDescriptor>,
  pub main: Option<BuiltInTargetDescriptor>,
  pub module: Option<BuiltInTargetDescriptor>,
  pub types: Option<BuiltInTargetDescriptor>,

  #[serde(flatten)]
  pub custom_targets: HashMap<String, TargetDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleFormat {
  CommonJS,
  Module,
}

#[derive(Deserialize)]
pub struct PackageJson {
  pub name: Option<String>,
  #[serde(rename = "type")]
  pub module_format: Option<ModuleFormat>,
  pub browser: Option<BrowserField>,
  pub main: Option<PathBuf>,
  pub module: Option<PathBuf>,
  pub types: Option<PathBuf>,
  #[serde(default)]
  pub engines: Option<Engines>,
  pub browserslist: Option<BrowsersList>,
  #[serde(default)]
  pub targets: TargetsField,
  #[serde(flatten)]
  pub fields: HashMap<String, serde_json::Value>,
}

#[derive(Clone, Deserialize)]
pub enum SourceMapField {
  Bool(bool),
  Options(TargetSourceMapOptions),
}
