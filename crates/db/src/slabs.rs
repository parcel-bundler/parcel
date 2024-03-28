use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::num::NonZeroU32;

use derivative::Derivative;
use parcel_derive::{ArenaAllocated, JsValue, SlabAllocated, ToJs};
use xxhash_rust::xxh3::Xxh3;

use crate::arena::{Arena, ArenaAllocated};
use crate::codegen::{js_bitflags, JsValue, ToJs};
use crate::slab::{Slab, SlabAllocated};
use crate::{current_db, ArenaVec, InternedString};

#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug, JsValue)]
#[js_type(TargetAddr)]
pub struct TargetId(pub NonZeroU32);

#[derive(PartialEq, Debug, Clone, ToJs, ArenaAllocated)]
pub struct Target {
  env: EnvironmentId,
  dist_dir: InternedString,
  dist_entry: Option<InternedString>,
  name: InternedString,
  public_url: InternedString,
  loc: Option<SourceLocation>,
  pipeline: Option<InternedString>,
  // source: Option<u32>
}

#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug, JsValue)]
#[js_type(EnvironmentAddr)]
pub struct EnvironmentId(pub NonZeroU32);

#[derive(Derivative, Clone, Debug, ToJs, SlabAllocated)]
#[derivative(PartialEq)]
pub struct Environment {
  pub context: EnvironmentContext,
  pub output_format: OutputFormat,
  pub source_type: SourceType,
  pub flags: EnvironmentFlags,
  pub source_map: Option<TargetSourceMapOptions>,
  #[derivative(PartialEq = "ignore")]
  pub loc: Option<SourceLocation>,
  pub include_node_modules: InternedString,
  pub engines: Engines,
}

#[derive(PartialEq, Clone, Debug, ToJs, JsValue, ArenaAllocated)]
pub struct Engines {
  pub browsers: ArenaVec<InternedString>,
  pub electron: Option<InternedString>,
  pub node: Option<InternedString>,
  pub parcel: Option<InternedString>,
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

#[derive(PartialEq, Clone, Debug, ToJs, JsValue, ArenaAllocated)]
pub struct TargetSourceMapOptions {
  source_root: Option<InternedString>,
  inline: bool,
  inline_sources: bool,
}

#[derive(PartialEq, Debug, Clone, ToJs, JsValue, ArenaAllocated)]
pub struct SourceLocation {
  pub file_path: InternedString,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Debug, Clone, ToJs, JsValue, ArenaAllocated)]
pub struct Location {
  pub line: u32,
  pub column: u32,
}

js_bitflags! {
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

#[derive(PartialEq, Clone, Copy, Debug, ToJs, JsValue)]
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

#[derive(PartialEq, Clone, Copy, Debug, ToJs, JsValue)]
pub enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug, ToJs, JsValue)]
pub enum OutputFormat {
  Global,
  Commonjs,
  Esmodule,
}

#[derive(PartialEq, Hash, Clone, Copy, Debug, JsValue)]
#[js_type(AssetAddr)]
pub struct AssetId(pub NonZeroU32);

#[derive(Debug, Clone, ToJs, JsValue, SlabAllocated)]
pub struct Asset {
  #[js_type(u32)]
  pub id: InternedString,
  pub file_path: InternedString,
  pub env: EnvironmentId,
  pub query: Option<InternedString>,
  pub asset_type: AssetType,
  pub content_key: InternedString,
  pub map_key: Option<InternedString>,
  pub output_hash: InternedString,
  pub pipeline: Option<InternedString>,
  pub meta: Option<InternedString>,
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: ArenaVec<Symbol>,
  pub unique_key: Option<InternedString>,
  // TODO: remove in next major version.
  pub ast: Option<AssetAst>,
}

#[derive(Debug, Clone, ToJs, JsValue, ArenaAllocated)]
pub struct AssetAst {
  pub key: InternedString,
  pub plugin: InternedString,
  pub config_path: InternedString,
  pub config_key_path: Option<InternedString>,
  pub generator: InternedString,
  pub version: InternedString,
}

#[derive(Debug, Clone, ToJs, JsValue)]
pub enum AssetType {
  Js,
  Jsx,
  Ts,
  Tsx,
  Css,
  Html,
  Other(InternedString),
}

#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy, ToJs, JsValue)]
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

#[derive(Debug, Clone, Default, ToJs, JsValue, ArenaAllocated)]
pub struct AssetStats {
  size: u32,
  time: u32,
}

js_bitflags! {
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

js_bitflags! {
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

#[derive(Debug, Clone, ToJs, JsValue, SlabAllocated)]
pub struct Dependency {
  #[js_type(u32)]
  pub id: InternedString,
  pub source_asset_id: Option<AssetId>,
  pub env: EnvironmentId,
  pub specifier: InternedString,
  pub specifier_type: SpecifierType,
  pub resolve_from: Option<InternedString>,
  pub range: Option<InternedString>,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub loc: Option<SourceLocation>,
  pub placeholder: Option<InternedString>,
  pub target: Option<TargetId>,
  pub symbols: ArenaVec<Symbol>,
  pub promise_symbol: Option<InternedString>,
  pub import_attributes: ArenaVec<ImportAttribute>,
  pub pipeline: Option<InternedString>,
  // These are stringified JSON
  pub meta: Option<InternedString>,
  pub resolver_meta: Option<InternedString>,
  pub package_conditions: ExportsCondition,
  pub custom_package_conditions: ArenaVec<InternedString>,
}

impl Dependency {
  pub fn new(specifier: InternedString, source_asset_id: AssetId) -> Dependency {
    let asset = current_db().get_asset(source_asset_id);
    Dependency {
      id: InternedString::default(),
      specifier,
      specifier_type: SpecifierType::Esm,
      source_asset_id: Some(source_asset_id),
      env: asset.env,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      resolve_from: None,
      range: None,
      loc: None,
      placeholder: None,
      target: None,
      symbols: ArenaVec::new(),
      promise_symbol: None,
      import_attributes: ArenaVec::new(),
      pipeline: None,
      meta: None,
      resolver_meta: None,
      package_conditions: ExportsCondition::empty(),
      custom_package_conditions: ArenaVec::new(),
    }
  }

  pub fn get_id_hash(&self) -> u64 {
    // Compute hashed dependency id.
    let mut hasher = Xxh3::new();
    if let Some(source_asset_id) = self.source_asset_id {
      let asset = current_db().get_asset(source_asset_id);
      asset.id.hash(&mut hasher);
    }
    self.specifier.hash(&mut hasher);
    self.specifier_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.target.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.bundle_behavior.hash(&mut hasher);
    self.priority.hash(&mut hasher);
    self.package_conditions.hash(&mut hasher);
    self.custom_package_conditions.hash(&mut hasher);
    hasher.finish()
  }

  pub fn commit(mut self) -> u32 {
    self.id = format!("{:016x}", self.get_id_hash()).into();
    self.into_arena()
  }
}

#[derive(Debug, Clone, ToJs, JsValue, SlabAllocated)]
pub struct ImportAttribute {
  pub key: InternedString,
  pub value: bool,
}

js_bitflags! {
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

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, ToJs, JsValue)]
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

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, ToJs, JsValue)]
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

#[derive(Clone, Debug, ToJs, JsValue, SlabAllocated)]
pub struct Symbol {
  #[js_type(u32)]
  pub exported: InternedString,
  #[js_type(u32)]
  pub local: InternedString,
  pub loc: Option<SourceLocation>,
  pub flags: SymbolFlags,
}

js_bitflags! {
  pub struct SymbolFlags: u8 {
    const IS_WEAK = 1 << 0;
    const IS_ESM = 1 << 1;
  }
}

#[derive(Default)]
pub struct Slabs {
  pub arena: Arena,
  pub environment_slab: Slab<Environment>,
  pub dependency_slab: Slab<Dependency>,
  pub asset_slab: Slab<Asset>,
  pub symbol_slab: Slab<Symbol>,
  pub import_attribute_slab: Slab<ImportAttribute>,
  pub interned_string_slab: Slab<InternedString>,
}

impl Slabs {
  pub fn write<W: std::io::Write>(&self, dest: &mut W) -> std::io::Result<()> {
    let slice = unsafe {
      std::slice::from_raw_parts(self as *const _ as *const u8, std::mem::size_of::<Slabs>())
    };
    dest.write(slice)?;
    Ok(())
  }

  pub fn read<R: std::io::Read>(source: &mut R) -> std::io::Result<Slabs> {
    let mut buf = [0 as u8; std::mem::size_of::<Slabs>()];
    source.read_exact(&mut buf)?;
    Ok(unsafe { std::mem::transmute(buf) })
  }
}

thread_local! {
  pub static SLABS: RefCell<Option<&'static mut Slabs>> = const { RefCell::new(None) };
}
