use std::collections::HashMap;
use std::ffi::OsStr;
use std::fmt::Display;
use std::path::PathBuf;

use parcel_core::types::engines::Engines;
use parcel_core::types::EnvironmentContext;
use parcel_core::types::OutputFormat;
use parcel_core::types::TargetSourceMapOptions;
use parcel_resolver::IncludeNodeModules;
use serde::Deserialize;
use serde::Deserializer;

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BrowserField {
  EntryPoint(PathBuf),
  // TODO false value
  ReplacementBySpecifier(HashMap<String, PathBuf>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BrowsersList {
  Browsers(Vec<String>),
  BrowsersByEnv(HashMap<String, Vec<String>>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BuiltInTargetDescriptor {
  Disabled(serde_bool::False),
  TargetDescriptor(TargetDescriptor),
}

#[derive(Debug, Clone, Default, Deserialize)]
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
  pub source: Option<SourceField>,
  pub source_map: Option<SourceMapField>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleFormat {
  CommonJS,
  Module,
}

impl Display for ModuleFormat {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      ModuleFormat::CommonJS => write!(f, "commonjs"),
      ModuleFormat::Module => write!(f, "module"),
    }
  }
}

#[derive(Debug, Deserialize)]
pub struct PackageJson {
  pub name: Option<String>,

  #[serde(rename = "type")]
  pub module_format: Option<ModuleFormat>,

  #[serde(default, deserialize_with = "browser_field")]
  pub browser: Option<BrowserField>,

  #[serde(default, deserialize_with = "main_field")]
  pub main: Option<PathBuf>,

  #[serde(default, deserialize_with = "module_field")]
  pub module: Option<PathBuf>,

  #[serde(default, deserialize_with = "types_field")]
  pub types: Option<PathBuf>,

  #[serde(default)]
  pub engines: Option<Engines>,

  pub browserslist: Option<BrowsersList>,

  #[serde(default)]
  pub targets: TargetsField,

  #[serde(flatten)]
  pub fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub enum SourceField {
  Source(String),
  Sources(Vec<String>),
}

#[derive(Debug, Clone, Deserialize)]
pub enum SourceMapField {
  Bool(bool),
  Options(TargetSourceMapOptions),
}

fn browser_field<'de, D>(deserializer: D) -> Result<Option<BrowserField>, D::Error>
where
  D: Deserializer<'de>,
{
  let browser = Option::<BrowserField>::deserialize(deserializer)?;

  if let Some(browser_field) = browser.as_ref() {
    let allowed_extensions = vec!["cjs", "js", "mjs"];
    match browser_field {
      BrowserField::EntryPoint(dist) => {
        validate_extension::<D>("browser", &dist, &allowed_extensions)?;
      }
      BrowserField::ReplacementBySpecifier(replacements) => {
        for dist in replacements.values() {
          validate_extension::<D>("browser", &dist, &allowed_extensions)?;
        }
      }
    };
  }

  Ok(browser)
}

#[derive(Debug, Default, Deserialize)]
pub struct TargetsField {
  #[serde(default, deserialize_with = "browser_target")]
  pub browser: Option<BuiltInTargetDescriptor>,

  #[serde(default, deserialize_with = "main_target")]
  pub main: Option<BuiltInTargetDescriptor>,

  #[serde(default, deserialize_with = "module_target")]
  pub module: Option<BuiltInTargetDescriptor>,

  #[serde(default, deserialize_with = "types_target")]
  pub types: Option<BuiltInTargetDescriptor>,

  #[serde(flatten)]
  #[serde(deserialize_with = "custom_targets")]
  pub custom_targets: HashMap<String, TargetDescriptor>,
}

fn browser_target<'de, D>(deserializer: D) -> Result<Option<BuiltInTargetDescriptor>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_target(deserializer, "browser")
}

fn custom_targets<'de, D>(deserializer: D) -> Result<HashMap<String, TargetDescriptor>, D::Error>
where
  D: Deserializer<'de>,
{
  // TODO Consider refactoring to a visitor for better performance
  let targets: HashMap<String, TargetDescriptor> = HashMap::deserialize(deserializer)?;

  for (target, target_descriptor) in targets.iter() {
    validate_scope_hoisting::<D>(target, target_descriptor)?;
  }

  Ok(targets)
}

fn main_field<'de, D>(deserializer: D) -> Result<Option<PathBuf>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_dist(deserializer, "main", vec!["cjs", "mjs", "js"])
}

fn main_target<'de, D>(deserializer: D) -> Result<Option<BuiltInTargetDescriptor>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_target(deserializer, "main")
}

fn module_field<'de, D>(deserializer: D) -> Result<Option<PathBuf>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_dist(deserializer, "module", vec!["js", "mjs"])
}

fn module_target<'de, D>(deserializer: D) -> Result<Option<BuiltInTargetDescriptor>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_target(deserializer, "module")
}

fn parse_builtin_dist<'de, D>(
  deserializer: D,
  target_name: &str,
  allowed_extensions: Vec<&str>,
) -> Result<Option<PathBuf>, D::Error>
where
  D: Deserializer<'de>,
{
  let builtin_dist = Option::<PathBuf>::deserialize(deserializer)?;

  if let Some(dist) = builtin_dist.as_ref() {
    validate_extension::<D>(target_name, dist, &allowed_extensions)?;
  }

  Ok(builtin_dist)
}

fn parse_builtin_target<'de, D>(
  deserializer: D,
  target_name: &str,
) -> Result<Option<BuiltInTargetDescriptor>, D::Error>
where
  D: Deserializer<'de>,
{
  let builtin_target = Option::<BuiltInTargetDescriptor>::deserialize(deserializer)?;

  if let Some(target_descriptor) = builtin_target.as_ref() {
    if let BuiltInTargetDescriptor::TargetDescriptor(target_descriptor) = target_descriptor {
      validate_scope_hoisting::<D>(target_name, target_descriptor)?;

      if target_descriptor
        .output_format
        .is_some_and(|f| f == OutputFormat::Global)
      {
        return Err(serde::de::Error::custom(format!(
          "The \"global\" output format is not supported in the {} target",
          target_name
        )));
      }
    }
  }

  Ok(builtin_target)
}

fn types_field<'de, D>(deserializer: D) -> Result<Option<PathBuf>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_dist(deserializer, "types", vec!["ts"])
}

fn types_target<'de, D>(deserializer: D) -> Result<Option<BuiltInTargetDescriptor>, D::Error>
where
  D: Deserializer<'de>,
{
  parse_builtin_target(deserializer, "types")
}

fn validate_extension<'de, D>(
  target: &str,
  dist: &PathBuf,
  allowed_extensions: &Vec<&str>,
) -> Result<(), D::Error>
where
  D: Deserializer<'de>,
{
  let target_dist_ext = dist
    .extension()
    .unwrap_or(OsStr::new(""))
    .to_string_lossy()
    .into_owned();

  if allowed_extensions.iter().all(|ext| &target_dist_ext != ext) {
    return Err(serde::de::Error::custom(format!(
      "Unexpected file type {:?} in \"{}\" target",
      dist.file_name().unwrap_or(OsStr::new(&dist)),
      target
    )));
  }

  Ok(())
}

fn validate_scope_hoisting<'de, D>(
  target: &str,
  target_descriptor: &TargetDescriptor,
) -> Result<(), D::Error>
where
  D: Deserializer<'de>,
{
  if target_descriptor.is_library.is_some_and(|l| l == true)
    && target_descriptor.scope_hoist.is_some_and(|s| s == false)
  {
    return Err(serde::de::Error::custom(format!(
      "Scope hoisting cannot be disabled for \"{}\" library target",
      target
    )));
  }

  Ok(())
}
