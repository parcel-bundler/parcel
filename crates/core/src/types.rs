use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::{collections::hash_map::DefaultHasher, num::NonZeroU32, path::PathBuf};

use bitflags::bitflags;
use browserslist::Distrib;
use indexmap::IndexMap;

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

#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug)]
pub struct EnvironmentId(pub NonZeroU32);

#[derive(Clone, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
  pub context: EnvironmentContext,
  pub output_format: OutputFormat,
  pub source_type: SourceType,
  pub flags: EnvironmentFlags,
  pub source_map: Option<TargetSourceMapOptions>,
  pub loc: Option<SourceLocation>,
  pub include_node_modules: IncludeNodeModules,
  pub engines: Engines,
}

#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
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
  let browsers: Vec<String> = browsers.iter().map(|b| b.to_string()).collect();
  browsers.serialize(serializer)
}

fn deserialize_browsers<'de, D>(deserializer: D) -> Result<Vec<Distrib>, D::Error>
where
  D: serde::Deserializer<'de>,
{
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IncludeNodeModules {
  Bool(bool),
  Array(Vec<String>),
  Map(IndexMap<String, bool>),
}

impl std::hash::Hash for IncludeNodeModules {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    match self {
      IncludeNodeModules::Bool(b) => b.hash(state),
      IncludeNodeModules::Array(a) => a.hash(state),
      IncludeNodeModules::Map(m) => {
        for (k, v) in m {
          k.hash(state);
          v.hash(state);
        }
      }
    }
  }
}

impl Default for IncludeNodeModules {
  fn default() -> Self {
    IncludeNodeModules::Bool(true)
  }
}

#[derive(PartialEq, Clone, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSourceMapOptions {
  source_root: Option<String>,
  inline: bool,
  inline_sources: bool,
}

#[derive(PartialEq, Debug, Clone, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
  pub file_path: PathBuf,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Debug, Clone, Hash, Serialize, Deserialize)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}

bitflags! {
  #[derive(Clone, Copy, Hash, Debug)]
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

// By default, bitflags serializes as a string, but we want the raw number instead.
macro_rules! impl_bitflags_serde {
  ($t: ty) => {
    impl Serialize for $t {
      fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
      where
        S: serde::Serializer,
      {
        self.bits().serialize(serializer)
      }
    }

    impl<'de> Deserialize<'de> for $t {
      fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
      where
        D: serde::Deserializer<'de>,
      {
        let bits = Deserialize::deserialize(deserializer)?;
        Ok(<$t>::from_bits_truncate(bits))
      }
    }
  };
}

impl_bitflags_serde!(EnvironmentFlags);

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize, Deserialize)]
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

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
  Global,
  Commonjs,
  Esmodule,
}

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct AssetId(pub NonZeroU32);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  pub file_path: PathBuf,
  pub env: Environment,
  pub query: Option<String>,
  #[serde(rename = "type")]
  pub asset_type: AssetType,
  pub content_key: u64,
  pub map_key: Option<u64>,
  pub output_hash: u64,
  pub pipeline: Option<String>,
  pub meta: Option<String>,
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: Vec<Symbol>,
  pub unique_key: Option<u64>,
}

impl Asset {
  pub fn id(&self) -> u64 {
    use std::hash::{Hash, Hasher};
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

#[derive(Debug, Clone, PartialEq, Hash)]
pub enum AssetType {
  Js,
  Jsx,
  Ts,
  Tsx,
  Css,
  Html,
  Other(String),
}

impl Serialize for AssetType {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.extension().serialize(serializer)
  }
}

impl<'de> Deserialize<'de> for AssetType {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let ext: String = Deserialize::deserialize(deserializer)?;
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

#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy, Serialize_repr, Deserialize_repr)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum BundleBehavior {
  None = 255,
  Inline = 0,
  Isolated = 1,
}

impl Default for BundleBehavior {
  fn default() -> Self {
    BundleBehavior::None
  }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AssetStats {
  pub size: u32,
  pub time: u32,
}

bitflags! {
  #[derive(Debug, Clone, Copy)]
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

impl_bitflags_serde!(AssetFlags);

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
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

impl_bitflags_serde!(ExportsCondition);

#[derive(Debug, Clone, Hash, Serialize, Deserialize)]
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
  pub target: Option<Box<Target>>,
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
      target: None,
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

#[derive(Debug, Clone, Hash, Serialize, Deserialize)]
pub struct ImportAttribute {
  pub key: String,
  pub value: bool,
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
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

impl_bitflags_serde!(DependencyFlags);

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize_repr, Deserialize_repr)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum SpecifierType {
  Esm = 0,
  Commonjs = 1,
  Url = 2,
  Custom = 3,
}

impl Default for SpecifierType {
  fn default() -> Self {
    SpecifierType::Esm
  }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize_repr, Deserialize_repr)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Priority {
  Sync = 0,
  Parallel = 1,
  Lazy = 2,
}

impl Default for Priority {
  fn default() -> Self {
    Priority::Sync
  }
}

#[derive(Clone, Debug, Hash, Serialize, Deserialize)]
pub struct Symbol {
  pub exported: String,
  pub local: String,
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
  }
}

impl_bitflags_serde!(SymbolFlags);

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

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct BundleFlags: u8 {
    const NEEDS_STABLE_NAME = 1 << 0;
    const IS_SPLITTABLE = 1 << 1;
    const IS_PLACEHOLDER = 1 << 2;
  }
}

impl_bitflags_serde!(BundleFlags);

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

// impl<'de> Deserialize<'de> for BuildMode {
//   fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
//   where
//     D: Deserializer<'de>,
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
