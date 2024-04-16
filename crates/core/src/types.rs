use std::{
  collections::{hash_map::DefaultHasher, HashMap},
  fmt::Display,
  num::NonZeroU32,
  path::PathBuf,
};

use bitflags::bitflags;

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

#[derive(Clone, Debug)]
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

#[derive(PartialEq, Clone, Debug)]
pub struct Engines {
  pub browsers: Vec<String>,
  pub electron: Option<String>,
  pub node: Option<String>,
  pub parcel: Option<String>,
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

#[derive(PartialEq, Clone, Debug)]
pub struct TargetSourceMapOptions {
  source_root: Option<String>,
  inline: bool,
  inline_sources: bool,
}

#[derive(PartialEq, Debug, Clone, Hash)]
pub struct SourceLocation {
  pub file_path: String,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Debug, Clone, Hash)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}

bitflags! {
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

#[derive(PartialEq, Clone, Copy, Debug)]
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

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum OutputFormat {
  Global,
  Commonjs,
  Esmodule,
}

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct AssetId(pub NonZeroU32);

#[derive(Debug, Clone)]
pub struct Asset {
  pub id: String,
  pub file_path: PathBuf,
  pub env: EnvironmentId,
  pub query: Option<String>,
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

#[derive(Debug, Clone)]
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

impl AssetType {
  pub fn extension(&self) -> &str {
    match self {
      AssetType::Js => ".js",
      AssetType::Jsx => ".jsx",
      AssetType::Ts => ".ts",
      AssetType::Tsx => ".tsx",
      AssetType::Css => ".css",
      AssetType::Html => ".html",
      AssetType::Other(s) => s.as_str(),
    }
  }
}

#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy)]
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

#[derive(Debug, Clone, Default)]
pub struct AssetStats {
  pub size: u32,
  pub time: u32,
}

bitflags! {
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

#[derive(Debug, Clone, Hash)]
pub struct Dependency {
  pub id: String,
  // pub source_asset_id: Option<AssetId>,
  pub source_path: Option<PathBuf>,
  pub env: EnvironmentId,
  pub specifier: String,
  pub specifier_type: SpecifierType,
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
  pub fn new(specifier: String, env: EnvironmentId) -> Dependency {
    Dependency {
      id: String::default(),
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

  // pub fn get_id_hash(&self) -> u64 {
  //   // Compute hashed dependency id.
  //   let mut hasher = DefaultHasher::new();
  //   self.source_asset_id.hash(&mut hasher);
  //   self.specifier.hash(&mut hasher);
  //   self.specifier_type.hash(&mut hasher);
  //   self.env.hash(&mut hasher);
  //   self.target.hash(&mut hasher);
  //   self.pipeline.hash(&mut hasher);
  //   self.bundle_behavior.hash(&mut hasher);
  //   self.priority.hash(&mut hasher);
  //   self.package_conditions.hash(&mut hasher);
  //   self.custom_package_conditions.hash(&mut hasher);
  //   hasher.finish()
  // }

  // pub fn commit(mut self) -> u32 {
  //   self.id = format!("{:016x}", self.get_id_hash()).into();
  //   self.into_arena()
  // }
}

#[derive(Debug, Clone, Hash)]
pub struct ImportAttribute {
  pub key: String,
  pub value: bool,
}

bitflags! {
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

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
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

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
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

#[derive(Clone, Debug, Hash)]
pub struct Symbol {
  pub exported: String,
  pub local: String,
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}

bitflags! {
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
