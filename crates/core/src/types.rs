use crate::{
  cache::Cache,
  environment::{Environment, EnvironmentFlags},
  intern::Interned,
};
use bitflags::bitflags;
use gxhash::GxHasher;
use indexmap::IndexMap;
use parcel_resolver::{ExportsCondition, FileSystem};
use serde::{Deserialize, Deserializer, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::{collections::HashMap, num::NonZeroU32, path::PathBuf, sync::Arc};

#[derive(Debug, Clone, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  pub env: Interned<Environment>,
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

#[derive(PartialEq, Eq, Debug, Clone, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
  pub file_path: Interned<PathBuf>,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Eq, Debug, Clone, Hash, Serialize, Deserialize)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct HashValue(pub u64);

impl Serialize for HashValue {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    if serializer.is_human_readable() {
      format!("{:016x}", self.0).serialize(serializer)
    } else {
      self.0.serialize(serializer)
    }
  }
}

impl<'de> Deserialize<'de> for HashValue {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: Deserializer<'de>,
  {
    if deserializer.is_human_readable() {
      let s: String = Deserialize::deserialize(deserializer)?;
      Ok(HashValue(
        u64::from_str_radix(&s, 16).map_err(|e| serde::de::Error::custom(e.to_string()))?,
      ))
    } else {
      let v: u64 = Deserialize::deserialize(deserializer)?;
      Ok(HashValue(v))
    }
  }
}

impl std::fmt::Display for HashValue {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{:016x}", self.0)
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  pub id: HashValue,
  pub file_path: Interned<PathBuf>,
  pub env: Interned<Environment>,
  pub query: Option<String>,
  #[serde(rename = "type")]
  pub asset_type: AssetType,
  pub content_key: HashValue,
  pub map_key: Option<HashValue>,
  pub output_hash: HashValue,
  pub pipeline: Option<String>,
  pub meta: JSONObject,
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: Vec<Symbol>,
  pub unique_key: Option<String>,
}

impl Asset {
  pub fn update_id(&mut self) {
    use std::hash::{Hash, Hasher};
    let mut hasher = GxHasher::default();
    self.file_path.hash(&mut hasher);
    self.asset_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.unique_key.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.query.hash(&mut hasher);
    self.id = HashValue(hasher.finish());
  }
}

// pub type JSONObject = serde_json::value::Map<String, serde_json::value::Value>;
pub type JSONObject = IndexMap<String, String>;

#[derive(Debug, Clone, Copy, PartialEq, Hash)]
pub enum AssetType {
  Js,
  Jsx,
  Ts,
  Tsx,
  Css,
  Html,
  Json,
  Other(Interned<String>),
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
      AssetType::Json => "json",
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
      "json" => AssetType::Json,
      ext => AssetType::Other(ext.into()),
    }
  }
}

#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy, Serialize_repr, Deserialize_repr)]
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

pub(crate) use impl_bitflags_serde;

impl_bitflags_serde!(AssetFlags);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  pub id: HashValue,
  pub source_asset_id: Option<HashValue>,
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub source_path: Option<Interned<PathBuf>>,
  pub env: Interned<Environment>,
  pub resolve_from: Option<Interned<PathBuf>>,
  pub range: Option<String>,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  #[serde(default)]
  pub loc: Option<SourceLocation>,
  #[serde(default)]
  pub placeholder: Option<String>,
  #[serde(default)]
  pub target: Option<Box<Target>>,
  #[serde(default)]
  pub symbols: Vec<Symbol>,
  #[serde(default)]
  pub promise_symbol: Option<Interned<String>>,
  #[serde(default)]
  pub import_attributes: Vec<ImportAttribute>,
  #[serde(default)]
  pub pipeline: Option<String>,
  #[serde(default)]
  pub meta: Option<Box<JSONObject>>,
  #[serde(default)]
  pub resolver_meta: Option<Box<JSONObject>>,
  #[serde(default)]
  pub package_conditions: ExportsCondition,
  #[serde(default)]
  pub custom_package_conditions: Vec<String>,
}

impl Dependency {
  pub fn entry(entry: String, target: Target) -> Dependency {
    let mut dep = Dependency {
      id: HashValue(0),
      source_asset_id: None,
      specifier: entry,
      specifier_type: SpecifierType::Url,
      source_path: None,
      env: target.env,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::ENTRY | DependencyFlags::NEEDS_STABLE_NAME,
      resolve_from: None,
      range: None,
      loc: None,
      placeholder: None,
      target: Some(Box::new(target)),
      symbols: Vec::new(),
      promise_symbol: None,
      import_attributes: Vec::new(),
      pipeline: None,
      meta: None,
      resolver_meta: None,
      package_conditions: ExportsCondition::empty(),
      custom_package_conditions: Vec::new(),
    };

    if dep.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
      dep.flags |= DependencyFlags::HAS_SYMBOLS;
      dep.symbols.push(Symbol {
        exported: "*".into(),
        local: "*".into(),
        flags: SymbolFlags::IS_WEAK,
        loc: None,
      });
    }

    dep.update_id();
    dep
  }

  pub fn new_from_asset(asset: &Asset, specifier: String, specifier_type: SpecifierType) -> Self {
    Dependency {
      id: HashValue(0),
      source_asset_id: Some(asset.id),
      specifier,
      specifier_type,
      source_path: Some(asset.file_path),
      env: asset.env,
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

  pub fn update_id(&mut self) {
    // Compute hashed dependency id.
    use std::hash::{Hash, Hasher};
    let mut hasher = GxHasher::default();
    self.source_asset_id.hash(&mut hasher);
    self.specifier.hash(&mut hasher);
    self.specifier_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.target.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.bundle_behavior.hash(&mut hasher);
    self.priority.hash(&mut hasher);
    self.package_conditions.hash(&mut hasher);
    self.custom_package_conditions.hash(&mut hasher);
    self.id = HashValue(hasher.finish());
  }
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
  pub exported: Interned<String>,
  pub local: Interned<String>,
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
    const SELF_REFERENCED = 1 << 2;
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
  pub env: Interned<Environment>,
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

pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: Interned<PathBuf>,
  pub core_path: PathBuf,
  pub input_fs: Arc<dyn FileSystem>,
  pub cache: Arc<dyn Cache>,
  pub resolver_cache: parcel_resolver::Cache<Arc<dyn FileSystem>>,
}

impl ParcelOptions {
  pub fn new(
    opts: BaseParcelOptions,
    input_fs: Arc<dyn FileSystem>,
    cache: Arc<dyn Cache>,
  ) -> Self {
    let resolver_cache = parcel_resolver::Cache::new(Arc::clone(&input_fs));
    ParcelOptions {
      mode: opts.mode,
      env: opts.env,
      log_level: opts.log_level,
      project_root: opts.project_root,
      core_path: opts.core_path,
      input_fs,
      cache,
      resolver_cache,
    }
  }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: Interned<PathBuf>,
  pub core_path: PathBuf,
}

#[derive(Clone, PartialEq, Debug)]
pub enum BuildMode {
  Development,
  Production,
  Other(String),
}

impl<'de> Deserialize<'de> for BuildMode {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: Deserializer<'de>,
  {
    let s = String::deserialize(deserializer)?;
    Ok(match s.as_str() {
      "development" => BuildMode::Development,
      "production" => BuildMode::Production,
      _ => BuildMode::Other(s),
    })
  }
}

#[derive(Clone, PartialEq, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
  None,
  Error,
  Warn,
  Info,
  Verbose,
}
