#![allow(non_snake_case)]
#![feature(thread_local)]

use std::cell::UnsafeCell;
use std::sync::Mutex;
use std::{num::NonZeroU32, sync::RwLock};

use alloc::{current_arena, current_heap, Arena, PageAllocator, Slab, SlabAllocated, ARENA, HEAP};
use derivative::Derivative;
use parcel_derive::{ArenaAllocated, JsValue, SlabAllocated, ToJs};
use thread_local::ThreadLocal;

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

// A mapping from type ids (indices) to factories to alloc/dealloc that type.
static mut FACTORIES: Vec<Factory> = Vec::new();

/// A factory allocates or deallocates values of a certain type.
struct Factory {
  alloc: fn() -> u32,
  dealloc: fn(u32),
}

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct FileId(u32);

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct TargetId(pub u32);

#[derive(PartialEq, Debug, ToJs, ArenaAllocated)]
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

#[derive(PartialEq, Clone, Copy, Debug, JsValue)]
pub struct EnvironmentId(pub u32);

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
  pub engines: InternedString,
}

// #[derive(PartialEq, Clone, Debug, ToJs, JsValue)]
// pub struct Engines {
//   browsers: ArenaVec<InternedString>,
//   electron: Option<InternedString>,
//   node: Option<InternedString>,
//   parcel: Option<InternedString>,
// }

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

#[derive(Debug, Clone, ToJs, JsValue, SlabAllocated)]
pub struct Asset {
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

#[derive(Debug, Clone, Copy, ToJs, JsValue)]
pub enum BundleBehavior {
  None,
  Inline,
  Isolated,
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
  pub source_asset_id: Option<u32>,
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
  pub target: TargetId,
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

#[derive(Clone, Copy, Debug, ToJs, JsValue)]
pub enum SpecifierType {
  Esm,
  Commonjs,
  Url,
  Custom,
}

#[derive(Clone, Copy, Debug, ToJs, JsValue)]
pub enum Priority {
  Sync,
  Parallel,
  Lazy,
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
  pub fn with<T, F: FnOnce(&ParcelDb) -> T>(&self, f: F) -> T {
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
  environments: RwLock<Vec<u32>>,
  heap: PageAllocator,
  strings: StringInterner,
  slabs: ThreadLocal<MutableSlabs>,
  available_slabs: Mutex<Vec<Slabs>>,
}

impl ParcelDb {
  pub fn new() -> ParcelDbWrapper {
    // DB_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    ParcelDbWrapper {
      inner: ParcelDb {
        environments: RwLock::new(Vec::new()),
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
    // SAFETY: FACTORIES is not mutated after initial registration.
    let factory = unsafe { &FACTORIES[type_id as usize] };
    (factory.alloc)()
  }

  pub fn dealloc(&self, type_id: u32, addr: u32) {
    // SAFETY: FACTORIES is not mutated after initial registration.
    let factory = unsafe { &FACTORIES[type_id as usize] };
    (factory.dealloc)(addr);
  }

  pub fn alloc_struct<T>(&self) -> (u32, &mut T) {
    // TODO: get rid of this function...
    unsafe {
      let size = std::mem::size_of::<T>();
      let addr = current_arena().alloc(size as u32);
      let ptr = current_heap().get(addr);
      (addr, &mut *ptr)
    }
  }

  pub fn read_string<'a>(&self, addr: u32) -> &str {
    unsafe { InternedString(NonZeroU32::new_unchecked(addr)).as_str() }
  }

  pub fn extend_vec(&self, addr: u32, size: u32, count: u32) {
    // TODO: handle different types of vectors...
    let vec: &mut ArenaVec<Symbol> = unsafe { &mut *self.heap.get(addr) };
    vec.reserve(count as usize);
  }

  pub fn get_environment(&self, addr: u32) -> &Environment {
    unsafe { &*self.heap.get(addr) }
  }

  pub fn get_asset(&self, addr: u32) -> &Asset {
    unsafe { &*self.heap.get(addr) }
  }

  pub fn get_asset_mut(&self, addr: u32) -> &mut Asset {
    // TODO: somehow make this safe...
    // It is undefined behavior to vend more than one mutable reference at a time.
    unsafe { &mut *self.heap.get(addr) }
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
        return EnvironmentId(*env);
      }
    }

    let addr = env.clone().commit();
    self.environments.write().unwrap().push(addr);
    EnvironmentId(addr)
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
    dest.write(&u32::to_le_bytes(environments.len() as u32))?;
    dest.write(unsafe { std::mem::transmute(environments.as_slice()) })?;

    Ok(())
  }

  pub fn read<R: std::io::Read>(source: &mut R) -> std::io::Result<ParcelDbWrapper> {
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

    source.read_exact(&mut buf)?;
    let len = u32::from_le_bytes(buf);
    let mut environments = Vec::with_capacity(len as usize);
    environments.reserve(len as usize);
    unsafe {
      environments.set_len(len as usize);
      source.read_exact(std::mem::transmute(environments.as_mut_slice()))?;
    }

    Ok(ParcelDbWrapper {
      inner: ParcelDb {
        environments: RwLock::new(environments),
        heap,
        strings,
        slabs: ThreadLocal::new(),
        available_slabs: Mutex::new(available_slabs),
      },
    })
  }
}
