#![allow(non_snake_case)]
#![feature(thread_local)]

use std::cell::UnsafeCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::{num::NonZeroU32, sync::RwLock};

use alloc::{current_heap, Arena, PageAllocator, Slab, SlabAllocated, ARENA, HEAP};
use derivative::Derivative;
use parcel_derive::{ArenaAllocated, JsValue, SlabAllocated, ToJs};
use serde::Deserialize;
use thread_local::ThreadLocal;
use xxhash_rust::xxh3::Xxh3;

mod alloc;
mod atomics;
pub mod codegen;
mod string;
mod vec;

pub use alloc::ArenaAllocated;
pub use string::InternedString;
pub use vec::ArenaVec;

use codegen::{js_bitflags, JsValue, ToJs};
use string::StringInterner;

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

#[derive(Clone, Debug, Deserialize)]
pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: String,
}

#[derive(Clone, PartialEq, Debug)]
pub enum BuildMode {
  Development,
  Production,
  Other(String),
}

impl<'de> serde::Deserialize<'de> for BuildMode {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
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

#[thread_local]
pub(crate) static mut SLABS: Option<&'static mut Slabs> = None;
#[thread_local]
static mut DB: Option<&'static ParcelDb> = None;

pub fn current_db<'a>() -> &'a ParcelDb {
  unsafe { DB.unwrap_unchecked() }
}

#[derive(Default)]
struct Slabs {
  arena: Arena,
  environment_slab: Slab<Environment>,
  dependency_slab: Slab<Dependency>,
  asset_slab: Slab<Asset>,
  symbol_slab: Slab<Symbol>,
  import_attribute_slab: Slab<ImportAttribute>,
  interned_string_slab: Slab<InternedString>,
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

pub struct ParcelDbWrapper {
  inner: ParcelDb,
}

// impl Drop for ParcelDbWrapper {
//   fn drop(&mut self) {
//     let count = DB_COUNT.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
//     println!("Drop native {}", count);
//   }
// }

impl ParcelDbWrapper {
  pub fn with<'a, T, F: FnOnce(&'a ParcelDb) -> T>(&'a self, f: F) -> T {
    unsafe {
      debug_assert!(HEAP.is_none());
      HEAP = Some(std::mem::transmute(&self.inner.heap));
      DB = Some(std::mem::transmute(&self.inner));

      let slabs = &mut *self
        .inner
        .slabs
        .get_or(|| {
          // Try to reuse existing Slabs from a previous Parcel run.
          let mut available_slabs = self.inner.available_slabs.lock().unwrap();
          let slabs = available_slabs.pop().unwrap_or_default();
          MutableSlabs(UnsafeCell::new(slabs))
        })
        .0
        .get();

      ARENA = Some(std::mem::transmute(&slabs.arena));
      SLABS = Some(std::mem::transmute(slabs));
      let res = f(&self.inner);
      HEAP = None;
      DB = None;
      ARENA = None;
      SLABS = None;
      res
    }
  }
}

struct MutableSlabs(UnsafeCell<Slabs>);
unsafe impl Sync for MutableSlabs {}

// static DB_COUNT: AtomicU32 = AtomicU32::new(0);

pub struct ParcelDb {
  pub options: ParcelOptions,
  environments: RwLock<Vec<EnvironmentId>>,
  targets: RwLock<Vec<TargetId>>,
  heap: PageAllocator,
  strings: StringInterner,
  slabs: ThreadLocal<MutableSlabs>,
  available_slabs: Mutex<Vec<Slabs>>,
}

impl ParcelDb {
  pub fn new(options: ParcelOptions) -> ParcelDbWrapper {
    // DB_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    ParcelDbWrapper {
      inner: ParcelDb {
        options,
        environments: RwLock::new(Vec::new()),
        targets: RwLock::new(Vec::new()),
        heap: PageAllocator::new(),
        strings: StringInterner::new(),
        slabs: ThreadLocal::new(),
        available_slabs: Mutex::new(Vec::new()),
      },
    }
  }

  pub fn heap_page(&self, page: u32) -> &mut [u8] {
    unsafe { self.heap.get_page(page) }
  }

  pub fn alloc(&self, type_id: u32) -> u32 {
    let factory = codegen::get_factory(type_id);
    (factory.alloc)()
  }

  pub fn dealloc(&self, type_id: u32, addr: u32) {
    let factory = codegen::get_factory(type_id);
    (factory.dealloc)(addr);
  }

  pub fn read_string<'a>(&self, addr: u32) -> &str {
    unsafe { InternedString(NonZeroU32::new_unchecked(addr)).as_str() }
  }

  pub fn extend_vec(&self, type_id: u32, addr: u32, count: u32) {
    let factory = codegen::get_factory(type_id);
    (factory.extend_vec)(addr, count);
  }

  pub fn get_environment(&self, addr: EnvironmentId) -> &Environment {
    unsafe { &*self.heap.get(addr.0.get()) }
  }

  pub fn get_asset(&self, addr: AssetId) -> &Asset {
    unsafe { &*self.heap.get(addr.0.get()) }
  }

  pub fn get_asset_mut(&self, addr: AssetId) -> &mut Asset {
    // TODO: somehow make this safe...
    // It is undefined behavior to vend more than one mutable reference at a time.
    unsafe { &mut *self.heap.get(addr.0.get()) }
  }

  pub fn environment_id(&self, env: &Environment) -> EnvironmentId {
    {
      if let Some(env) = self
        .environments
        .read()
        .unwrap()
        .iter()
        .find(|e| self.get_environment(**e) == env)
      {
        return *env;
      }
    }

    let addr = env.clone().into_arena();
    let id = EnvironmentId(NonZeroU32::new(addr).unwrap());
    self.environments.write().unwrap().push(id);
    id
  }

  pub fn get_target(&self, addr: TargetId) -> &Target {
    unsafe { &*self.heap.get(addr.0.get()) }
  }

  pub fn target_id(&self, target: &Target) -> TargetId {
    {
      if let Some(target) = self
        .targets
        .read()
        .unwrap()
        .iter()
        .find(|e| self.get_target(**e) == target)
      {
        return *target;
      }
    }

    let addr = target.clone().into_arena();
    let id = TargetId(NonZeroU32::new(addr).unwrap());
    self.targets.write().unwrap().push(id);
    id
  }

  pub fn write<W: std::io::Write>(&self, dest: &mut W) -> std::io::Result<()> {
    // Write header with version number.
    write!(dest, "parceldb")?;
    dest.write(&u16::to_le_bytes(1))?;

    // Write slab metadata so we can reuse pages when we start back up.
    // Write both used slabs and remaining available slabs.
    let available_slabs = self.available_slabs.lock().unwrap();
    let num_slabs = self.slabs.iter().count() + available_slabs.len();
    dest.write(&u32::to_le_bytes(num_slabs as u32))?;
    for slab in self.slabs.iter() {
      let slab = unsafe { &*slab.0.get() };
      slab.write(dest)?;
    }

    for slab in available_slabs.iter() {
      slab.write(dest)?;
    }

    self.heap.write(dest)?;
    self.strings.write(dest)?;

    let environments = self.environments.read().unwrap();
    write_vec(&environments, dest)?;

    let targets = self.targets.read().unwrap();
    write_vec(&targets, dest)?;

    Ok(())
  }

  pub fn read<R: std::io::Read>(
    source: &mut R,
    options: ParcelOptions,
  ) -> std::io::Result<ParcelDbWrapper> {
    let mut header: [u8; 10] = [0; 10];
    source.read_exact(&mut header)?;
    let version = u16::from_le_bytes([header[8], header[9]]);
    if &header[0..8] != "parceldb".as_bytes() || version != 1 {
      return Err(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        "Invalid header",
      ));
    }

    // Read previous slabs. When a thread starts up it will pull one of these from the queue of available slabs.
    // This allows us to reuse metadata such as the free list for each type.
    let mut buf: [u8; 4] = [0; 4];
    source.read_exact(&mut buf)?;
    let num_slabs = u32::from_le_bytes(buf);

    let mut available_slabs = Vec::with_capacity(num_slabs as usize);
    for _ in 0..num_slabs {
      let slabs = Slabs::read(source)?;
      available_slabs.push(slabs);
    }

    let heap = PageAllocator::read(source)?;
    let strings = StringInterner::read(source)?;

    let environments = read_vec(source)?;
    let targets = read_vec(source)?;

    Ok(ParcelDbWrapper {
      inner: ParcelDb {
        options,
        environments: RwLock::new(environments),
        targets: RwLock::new(targets),
        heap,
        strings,
        slabs: ThreadLocal::new(),
        available_slabs: Mutex::new(available_slabs),
      },
    })
  }
}

fn write_vec<T, W: std::io::Write>(v: &Vec<T>, dest: &mut W) -> std::io::Result<()> {
  dest.write(&u32::to_le_bytes(v.len() as u32))?;
  dest.write(unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 4) })?;
  Ok(())
}

fn read_vec<T, R: std::io::Read>(source: &mut R) -> std::io::Result<Vec<T>> {
  let mut buf: [u8; 4] = [0; 4];
  source.read_exact(&mut buf)?;
  let len = u32::from_le_bytes(buf);
  let mut res = Vec::with_capacity(len as usize);
  res.reserve(len as usize);
  unsafe {
    res.set_len(len as usize);
    let slice = std::slice::from_raw_parts_mut(res.as_mut_ptr() as *mut u8, res.len() * 4);
    source.read_exact(slice)?;
  }

  Ok(res)
}
