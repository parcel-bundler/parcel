#![allow(non_snake_case)]

use std::cell::{RefCell, UnsafeCell};
use std::collections::HashMap;
use std::sync::Mutex;
use std::{num::NonZeroU32, sync::RwLock};

use page_allocator::{PageAllocator, HEAP};

use parcel_derive::ArenaAllocated;
use serde::Deserialize;
use slabs::Slabs;
use thread_local::ThreadLocal;

mod arena;
mod atomics;
pub mod codegen;
mod page_allocator;
mod slab;
mod slabs;
mod string;
mod vec;

pub use arena::ArenaAllocated;
pub use page_allocator::current_heap;
pub use slabs::{
  Asset, AssetFlags, AssetId, AssetType, BundleBehavior, Dependency, DependencyFlags, Environment,
  EnvironmentContext, EnvironmentFlags, EnvironmentId, ImportAttribute, Location, OutputFormat,
  Priority, SourceLocation, SourceType, SpecifierType, Symbol, SymbolFlags, Target, TargetId,
  SLABS,
};
pub use string::InternedString;
pub use vec::ArenaVec;

use string::StringInterner;

use crate::arena::ARENA_ADDR;

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

#[derive(Clone, Debug, Deserialize)]
pub struct ParcelOptions {
  pub mode: BuildMode,
  pub env: HashMap<String, String>,
  pub log_level: LogLevel,
  pub project_root: String,
}

thread_local! {
  static DB: RefCell<Option<&'static ParcelDb>> = const { RefCell::new(None) };
}

pub fn current_db<'a>() -> &'a ParcelDb {
  unsafe { DB.with_borrow(|slabs| slabs.unwrap_unchecked()) }
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
      debug_assert!(HEAP.with_borrow(|heap| heap.is_none()));

      HEAP.replace(Some(std::mem::transmute(&self.inner.heap)));
      DB.replace(Some(std::mem::transmute(&self.inner)));

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

      slabs.arena.addr.with(|a| {
        let addr = *a.borrow();
        ARENA_ADDR.replace(addr);
      });

      SLABS.replace(Some(std::mem::transmute(slabs)));

      let res = f(&self.inner);
      HEAP.replace(None);
      DB.replace(None);
      ARENA_ADDR.replace(1);
      SLABS.replace(None);
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
    self.heap.get_page(page)
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
