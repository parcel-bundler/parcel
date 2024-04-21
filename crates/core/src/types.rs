use std::{collections::hash_map::DefaultHasher, num::NonZeroU32, path::PathBuf};

use bitflags::bitflags;
use browserslist::Distrib;

#[derive(PartialEq, Debug, Clone)]
pub struct Target {
  env: EnvironmentId,
  dist_dir: String,
  dist_entry: Option<String>,
  name: String,
  public_url: String,
  loc: Option<SourceLocation>,
  pipeline: Option<String>,
  // source: Option<u32>
}

#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug)]
pub struct EnvironmentId(pub NonZeroU32);

#[derive(Clone, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
  pub context: EnvironmentContext,
  pub output_format: OutputFormat,
  pub source_type: SourceType,
  pub flags: EnvironmentFlags,
  pub source_map: Option<TargetSourceMapOptions>,
  pub loc: Option<SourceLocation>,
  pub include_node_modules: String,
  pub engines: Engines,
}

#[derive(PartialEq, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Engines {
  #[serde(
    serialize_with = "serialize_browsers",
    deserialize_with = "deserialize_browsers"
  )]
  pub browsers: Vec<Distrib>,
  pub electron: Option<String>,
  pub node: Option<String>,
  pub parcel: Option<String>,
}

fn serialize_browsers<S>(browsers: &Vec<Distrib>, serializer: S) -> Result<S::Ok, S::Error>
where
  S: serde::Serializer,
{
  use serde::Serialize;
  let browsers: Vec<String> = browsers.iter().map(|b| b.to_string()).collect();
  browsers.serialize(serializer)
}

fn deserialize_browsers<'de, D>(deserializer: D) -> Result<Vec<Distrib>, D::Error>
where
  D: serde::Deserializer<'de>,
{
  use serde::Deserialize;
  let browsers: Vec<String> = Deserialize::deserialize(deserializer)?;
  let distribs = browserslist::resolve(browsers, &Default::default()).unwrap_or(Vec::new());
  Ok(distribs)
}

// List of browsers to exclude when the esmodule target is specified.
// Based on https://caniuse.com/#feat=es6-module
const ESMODULE_BROWSERS: &'static [&'static str] = &[
  "not ie <= 11",
  "not edge < 16",
  "not firefox < 60",
  "not chrome < 61",
  "not safari < 11",
  "not opera < 48",
  "not ios_saf < 11",
  "not op_mini all",
  "not android < 76",
  "not blackberry > 0",
  "not op_mob > 0",
  "not and_chr < 76",
  "not and_ff < 68",
  "not ie_mob > 0",
  "not and_uc > 0",
  "not samsung < 8.2",
  "not and_qq > 0",
  "not baidu > 0",
  "not kaios > 0",
];

impl Engines {
  pub fn from_browserslist(browserslist: &str, output_format: OutputFormat) -> Engines {
    let browsers = if output_format == OutputFormat::Esmodule {
      // If the output format is esmodule, exclude browsers
      // that support them natively so that we transpile less.
      browserslist::resolve(
        std::iter::once(browserslist).chain(ESMODULE_BROWSERS.iter().map(|s| *s)),
        &Default::default(),
      )
    } else {
      browserslist::resolve(std::iter::once(browserslist), &Default::default())
    };

    Engines {
      browsers: browsers.unwrap_or(Vec::new()),
      electron: None,
      node: None,
      parcel: None,
    }
  }
}

impl std::hash::Hash for Engines {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    for browser in &self.browsers {
      browser.name().hash(state);
      browser.version().hash(state);
    }
    self.electron.hash(state);
    self.node.hash(state);
    self.parcel.hash(state);
  }
}

// #[derive(Clone)]
// pub enum IncludeNodeModules {
//   Bool(bool),
//   Array(Vec<String>),
//   Map(HashMap<String, bool>),
// }

// impl Default for IncludeNodeModules {
//   fn default() -> Self {
//     IncludeNodeModules::Bool(true)
//   }
// }

#[derive(PartialEq, Clone, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSourceMapOptions {
  source_root: Option<String>,
  inline: bool,
  inline_sources: bool,
}

#[derive(PartialEq, Debug, Clone, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
  pub file_path: PathBuf,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Debug, Clone, Hash, serde::Serialize, serde::Deserialize)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}

bitflags! {
  #[derive(serde::Serialize, serde::Deserialize)]
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

#[derive(PartialEq, Clone, Copy, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentContext {
  Browser,
  WebWorker,
  ServiceWorker,
  Worklet,
  Node,
  ElectronMain,
  ElectronRenderer,
}

impl EnvironmentContext {
  pub fn is_node(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, Node | ElectronMain | ElectronRenderer)
  }

  pub fn is_browser(&self) -> bool {
    use EnvironmentContext::*;
    matches!(
      self,
      Browser | WebWorker | ServiceWorker | Worklet | ElectronRenderer
    )
  }

  pub fn is_worker(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, WebWorker | ServiceWorker)
  }

  pub fn is_electron(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, ElectronMain | ElectronRenderer)
  }
}

#[derive(PartialEq, Clone, Copy, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
  Global,
  Commonjs,
  Esmodule,
}

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct AssetId(pub NonZeroU32);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  pub id: String,
  pub file_path: PathBuf,
  pub env: Environment,
  pub query: Option<String>,
  #[serde(rename = "type")]
  pub asset_type: AssetType,
  pub content_key: String,
  pub map_key: Option<String>,
  pub output_hash: String,
  pub pipeline: Option<String>,
  pub meta: Option<String>,
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: Vec<Symbol>,
  pub unique_key: Option<String>,
  // TODO: remove in next major version.
  pub ast: Option<AssetAst>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetAst {
  pub key: String,
  pub plugin: String,
  pub config_path: String,
  pub config_key_path: Option<String>,
  pub generator: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AssetType {
  Js,
  Jsx,
  Ts,
  Tsx,
  Css,
  Html,
  Other(String),
}

impl serde::Serialize for AssetType {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.extension().serialize(serializer)
  }
}

impl<'de> serde::Deserialize<'de> for AssetType {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let ext: String = serde::Deserialize::deserialize(deserializer)?;
    Ok(Self::from_extension(&ext))
  }
}

impl AssetType {
  pub fn extension(&self) -> &str {
    match self {
      AssetType::Js => "js",
      AssetType::Jsx => "jsx",
      AssetType::Ts => "ts",
      AssetType::Tsx => "tsx",
      AssetType::Css => "css",
      AssetType::Html => "html",
      AssetType::Other(s) => s.as_str(),
    }
  }

  pub fn from_extension(ext: &str) -> AssetType {
    match ext {
      "js" => AssetType::Js,
      "jsx" => AssetType::Jsx,
      "ts" => AssetType::Ts,
      "tsx" => AssetType::Tsx,
      "css" => AssetType::Css,
      "html" => AssetType::Html,
      ext => AssetType::Other(ext.to_string()),
    }
  }
}

#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleBehavior {
  None,
  Inline,
  Isolated,
}

impl Default for BundleBehavior {
  fn default() -> Self {
    BundleBehavior::None
  }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct AssetStats {
  pub size: u32,
  pub time: u32,
}

bitflags! {
  #[derive(serde::Serialize, serde::Deserialize)]
  pub struct AssetFlags: u32 {
    const IS_SOURCE = 1 << 0;
    const SIDE_EFFECTS = 1 << 1;
    const IS_BUNDLE_SPLITTABLE = 1 << 2;
    const LARGE_BLOB = 1 << 3;
    const HAS_CJS_EXPORTS = 1 << 4;
    const STATIC_EXPORTS = 1 << 5;
    const SHOULD_WRAP = 1 << 6;
    const IS_CONSTANT_MODULE = 1 << 7;
    const HAS_NODE_REPLACEMENTS = 1 << 8;
    const HAS_SYMBOLS = 1 << 9;
  }
}

bitflags! {
  #[derive(serde::Serialize, serde::Deserialize)]
  pub struct ExportsCondition: u32 {
    const IMPORT = 1 << 0;
    const REQUIRE = 1 << 1;
    const MODULE = 1 << 2;
    const STYLE = 1 << 12;
    const SASS = 1 << 13;
    const LESS = 1 << 14;
    const STYLUS = 1 << 15;
  }
}

#[derive(Debug, Clone, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  // pub id: String,
  // pub source_asset_id: Option<AssetId>,
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub source_path: Option<PathBuf>,
  pub env: Environment,
  pub resolve_from: Option<String>,
  pub range: Option<String>,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub loc: Option<SourceLocation>,
  pub placeholder: Option<String>,
  // pub target: Option<TargetId>,
  pub symbols: Vec<Symbol>,
  pub promise_symbol: Option<String>,
  pub import_attributes: Vec<ImportAttribute>,
  pub pipeline: Option<String>,
  // These are stringified JSON
  pub meta: Option<String>,
  pub resolver_meta: Option<String>,
  pub package_conditions: ExportsCondition,
  pub custom_package_conditions: Vec<String>,
}

impl Dependency {
  pub fn new(specifier: String, env: Environment) -> Dependency {
    Dependency {
      // id: String::default(),
      specifier,
      specifier_type: SpecifierType::Esm,
      source_path: None, //Some(source_asset.id),
      env,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      resolve_from: None,
      range: None,
      loc: None,
      placeholder: None,
      // target: None,
      symbols: Vec::new(),
      promise_symbol: None,
      import_attributes: Vec::new(),
      pipeline: None,
      meta: None,
      resolver_meta: None,
      package_conditions: ExportsCondition::empty(),
      custom_package_conditions: Vec::new(),
    }
  }

  pub fn id(&self) -> u64 {
    // Compute hashed dependency id.
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    self.source_path.hash(&mut hasher);
    self.specifier.hash(&mut hasher);
    self.specifier_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    // self.target.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.bundle_behavior.hash(&mut hasher);
    self.priority.hash(&mut hasher);
    self.package_conditions.hash(&mut hasher);
    self.custom_package_conditions.hash(&mut hasher);
    hasher.finish()
  }

  // pub fn commit(mut self) -> u32 {
  //   self.id = format!("{:016x}", self.get_id_hash()).into();
  //   self.into_arena()
  // }
}

#[derive(Debug, Clone, Hash, serde::Serialize, serde::Deserialize)]
pub struct ImportAttribute {
  pub key: String,
  pub value: bool,
}

bitflags! {
  #[derive(serde::Serialize, serde::Deserialize)]
  pub struct DependencyFlags: u8 {
    const ENTRY    = 1 << 0;
    const OPTIONAL = 1 << 1;
    const NEEDS_STABLE_NAME = 1 << 2;
    const SHOULD_WRAP = 1 << 3;
    const IS_ESM = 1 << 4;
    const IS_WEBWORKER = 1 << 5;
    const HAS_SYMBOLS = 1 << 6;
  }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpecifierType {
  Esm,
  Commonjs,
  Url,
  Custom,
}

impl Default for SpecifierType {
  fn default() -> Self {
    SpecifierType::Esm
  }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
  Sync,
  Parallel,
  Lazy,
}

impl Default for Priority {
  fn default() -> Self {
    Priority::Sync
  }
}

#[derive(Clone, Debug, Hash, serde::Serialize, serde::Deserialize)]
pub struct Symbol {
  pub exported: String,
  pub local: String,
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}

bitflags! {
  #[derive(serde::Serialize, serde::Deserialize)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
  }
}

// #[derive(Clone, Debug)]
// pub struct ParcelOptions {
//   pub mode: BuildMode,
//   pub env: HashMap<String, String>,
//   pub log_level: LogLevel,
//   pub project_root: String,
// }

// #[derive(Clone, PartialEq, Debug)]
// pub enum BuildMode {
//   Development,
//   Production,
//   Other(String),
// }

// impl<'de> serde::Deserialize<'de> for BuildMode {
//   fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
//   where
//     D: serde::Deserializer<'de>,
//   {
//     let s = String::deserialize(deserializer)?;
//     Ok(match s.as_str() {
//       "development" => BuildMode::Development,
//       "production" => BuildMode::Production,
//       _ => BuildMode::Other(s),
//     })
//   }
// }

// #[derive(Clone, PartialEq, Debug, Deserialize)]
// #[serde(rename_all = "lowercase")]
// pub enum LogLevel {
//   None,
//   Error,
//   Warn,
//   Info,
//   Verbose,
// }
