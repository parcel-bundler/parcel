#![allow(non_snake_case)]

use std::{
  ptr::NonNull,
  sync::{
    atomic::{AtomicU32, Ordering},
    RwLock,
  },
};

use allocator_api2::{
  alloc::{AllocError, Allocator, Layout},
  vec::Vec,
};
use parcel_derive::{JsValue, ToJs};

static mut WRITE_CALLBACKS: Vec<fn(&mut std::fs::File) -> std::io::Result<()>> = Vec::new();

trait ToJs {
  fn to_js() -> String;
}

trait JsValue {
  fn js_getter(addr: usize) -> String;
  fn js_setter(addr: usize, value: &str) -> String;
  fn ty() -> String;
}

impl JsValue for u8 {
  fn js_getter(addr: usize) -> String {
    format!("HEAP[this.addr + {:?}]", addr)
  }

  fn js_setter(addr: usize, value: &str) -> String {
    format!("HEAP[this.addr + {:?}] = {}", addr, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for u32 {
  fn js_getter(addr: usize) -> String {
    format!("HEAP_u32[(this.addr + {:?}) >> 2]", addr)
  }

  fn js_setter(addr: usize, value: &str) -> String {
    format!("HEAP_u32[(this.addr + {:?}) >> 2] = {}", addr, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for bool {
  fn js_getter(addr: usize) -> String {
    format!("!!HEAP[this.addr + {:?}]", addr)
  }

  fn js_setter(addr: usize, value: &str) -> String {
    format!("HEAP[this.addr + {:?}] = {} ? 1 : 0", addr, value)
  }

  fn ty() -> String {
    "boolean".into()
  }
}

impl JsValue for String {
  fn js_getter(addr: usize) -> String {
    format!("binding.readString(this.addr + {addr})", addr = addr)
  }

  fn js_setter(addr: usize, value: &str) -> String {
    format!(
      "binding.writeString(this.addr + {addr}, {value})",
      addr = addr,
      value = value
    )
  }

  fn ty() -> String {
    "string".into()
  }
}

impl<T: JsValue, A: Allocator> JsValue for Vec<T, A> {
  fn js_getter(addr: usize) -> String {
    let size = std::mem::size_of::<T>();
    let ty = <T>::ty();
    format!(
      "new Vec(this.addr + {addr}, {size}, {ty})",
      addr = addr,
      size = size,
      ty = ty
    )
  }

  fn js_setter(_addr: usize, _value: &str) -> String {
    "throw new Error('Cannot set a Vec')".into()
  }

  fn ty() -> String {
    format!("Vec<{}>", <T>::ty())
  }
}

fn option_offset<T>() -> usize {
  let mut v = std::mem::MaybeUninit::<T>::uninit();
  // let ptr = v.as_mut_ptr() as *mut u8;
  // unsafe { *ptr = 1 };
  let slice =
    unsafe { std::slice::from_raw_parts_mut(v.as_mut_ptr() as *mut u8, std::mem::size_of::<T>()) };
  for b in slice {
    *b = 1;
  }
  // unsafe {
  //   println!(
  //     "{:?}",
  //     std::slice::from_raw_parts(v.as_ptr() as *const u8, std::mem::size_of::<T>())
  //   );
  // }
  let option = Some(unsafe { v.assume_init() });
  let base = &option as *const _ as usize;
  let offset = (option.as_ref().unwrap() as *const _ as usize) - base;
  std::mem::forget(option);
  offset
}

fn discriminant(size: usize, addr: usize) -> String {
  match size {
    1 => u8::js_getter(addr),
    4 => u32::js_getter(addr),
    _ => todo!(),
  }
}

impl<T: JsValue> JsValue for Option<T> {
  fn js_getter(addr: usize) -> String {
    let offset = option_offset::<T>();
    if offset == 0 {
      let discriminant = if std::mem::size_of::<usize>() == 8 {
        format!(
          "HEAP_u32[this.addr + {:?} >> 2] === 0 && HEAP_u32[(this.addr + {:?} >> 2) + 1] === 0",
          addr, addr,
        )
      } else {
        format!("HEAP_u32[this.addr + {:?} >> 2] === 0", addr)
      };

      format!("{} ? null : {}", discriminant, T::js_getter(addr + offset))
    } else {
      format!(
        "{} ? null : {}",
        discriminant(offset, addr),
        T::js_getter(addr + offset)
      )
    }
  }

  fn js_setter(addr: usize, value: &str) -> String {
    // TODO: run Rust destructors when setting to null...
    let offset = option_offset::<T>();
    if offset == 0 {
      return format!(
        r#"if (value == null) {{
      HEAP.fill(0, this.addr + {addr}, this.addr + {addr} + {size});
    }} else {{
      {setter};
    }}"#,
        addr = addr,
        size = std::mem::size_of::<Option<T>>(),
        setter = T::js_setter(addr, value)
      );
    }

    format!(
      r#"{} = value == null ? 0 : 1;
    if (value != null) {}"#,
      discriminant(offset, addr),
      T::js_setter(addr + offset, value)
    )
  }

  fn ty() -> String {
    format!("?{}", <T>::ty())
  }
}

macro_rules! js_bitflags {
  (
    $(#[$outer:meta])*
    $vis:vis struct $BitFlags:ident: $T:ty {
      $(
        $(#[$inner:ident $($args:tt)*])*
        const $Flag:ident $(($vp:ident))? = $value:expr;
      )*
    }
  ) => {
    bitflags::bitflags! {
      $(#[$outer])*
      #[derive(Debug, PartialEq, Clone)]
      $vis struct $BitFlags: $T {
        $(
          $(#[$inner $($args)*])*
            const $Flag = $value;
        )*
      }
    }

    impl JsValue for $BitFlags {
      fn js_getter(addr: usize) -> String {
        <$T>::js_getter(addr)
      }

      fn js_setter(addr: usize, value: &str) -> String {
        <$T>::js_setter(addr, value)
      }

      fn ty() -> String {
        <$T>::ty()
      }
    }

    impl ToJs for $BitFlags {
      fn to_js() -> String {
        let mut js = String::new();
        js.push_str(&format!("export const {} = {{\n", stringify!($BitFlags)));
        $(
          js.push_str(&format!("  {}: 0b{:b},\n", stringify!($Flag), $BitFlags::$Flag));
        )*
        js.push_str("};\n");
        js
      }
    }

    paste::paste! {
      #[ctor::ctor]
      #[allow(non_snake_case)]
      unsafe fn [<register_ $BitFlags>]() {
        use std::io::Write;
        WRITE_CALLBACKS.push(|file| write!(file, "{}", $BitFlags::to_js()))
      }
    }
  }
}

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct FileId(u32);

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct TargetId(u32);

#[derive(PartialEq, Debug, ToJs)]
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

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct EnvironmentId(u32);

#[derive(PartialEq, Clone, Debug, ToJs)]
pub struct Environment {
  context: EnvironmentContext,
  output_format: OutputFormat,
  source_type: SourceType,
  flags: EnvironmentFlags,
  source_map: Option<TargetSourceMapOptions>,
  loc: Option<SourceLocation>,
  include_node_modules: String,
}

// pub struct Engines {
//   // browsers:
//   electron: Option<String>,
//   node: Option<String>,
//   parcel: Option<String>
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

#[derive(PartialEq, Clone, Debug, ToJs, JsValue)]
pub struct TargetSourceMapOptions {
  source_root: Option<String>,
  inline: bool,
  inline_sources: bool,
}

#[derive(PartialEq, Debug, Clone, ToJs, JsValue)]
pub struct SourceLocation {
  file_id: FileId,
  start: Location,
  end: Location,
}

#[derive(PartialEq, Debug, Clone, ToJs, JsValue)]
pub struct Location {
  line: u32,
  column: u32,
}

js_bitflags! {
  struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

#[derive(PartialEq, Clone, Copy, Debug, ToJs, JsValue)]
enum EnvironmentContext {
  Browser,
  WebWorker,
  ServiceWorker,
  Worklet,
  Node,
  ElectronMain,
  ElectronRenderer,
}

#[derive(PartialEq, Clone, Copy, Debug, ToJs, JsValue)]
enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug, ToJs, JsValue)]
enum OutputFormat {
  Global,
  Commonjs,
  Esmodule,
}

#[derive(Debug, ToJs, JsValue)]
pub struct Asset {
  pub file_path: String,
  pub env: EnvironmentId,
  pub query: Option<String>,
  pub asset_type: AssetType,
  pub content_key: String,
  pub map_key: Option<String>,
  pub output_hash: String,
  // meta??
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: Vec<Symbol, Alloc>,
  pub unique_key: Option<String>,
}

#[derive(Debug, ToJs, JsValue)]
pub enum AssetType {
  Js,
  Css,
  Html,
  Other,
}

#[derive(Debug, Clone, Copy, ToJs, JsValue)]
pub enum BundleBehavior {
  None,
  Inline,
  Isolated,
}

#[derive(Debug, Default, ToJs, JsValue)]
pub struct AssetStats {
  size: u32,
  time: u32,
}

js_bitflags! {
  pub struct AssetFlags: u8 {
    const IS_SOURCE = 0b00000001;
    const SIDE_EFFECTS = 0b00000010;
    const IS_BUNDLE_SPLITTABLE = 0b00000100;
    const LARGE_BLOB = 0b00001000;
  }
}

#[derive(Debug, ToJs, JsValue)]
pub struct Dependency {
  pub source_asset_id: Option<u32>,
  pub env: EnvironmentId,
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub resolve_from: Option<String>,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub loc: Option<SourceLocation>,
  // meta/resolver_meta/target
  // symbols
  // range
  // pipeline
  pub placeholder: Option<String>,
  pub target: TargetId,
  pub symbols: Vec<Symbol, Alloc>,
}

js_bitflags! {
  pub struct DependencyFlags: u8 {
    const ENTRY    = 0b00000001;
    const OPTIONAL = 0b00000010;
    const NEEDS_STABLE_NAME = 0b00000100;
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

#[derive(Clone, Debug, ToJs, JsValue)]
pub struct Symbol {
  exported: String,
  local: String,
  loc: Option<SourceLocation>,
  is_weak: bool,
}

static mut HEAP: aligned::Aligned<aligned::A8, [u8; 10485760]> = aligned::Aligned([0; 10485760]);
static HEAP_PTR: AtomicU32 = AtomicU32::new(0);

fn alloc(size: u32) -> u32 {
  // super dumb allocator.
  let addr = HEAP_PTR.fetch_add(size, Ordering::SeqCst);
  if addr + size >= unsafe { HEAP.len() } as u32 {
    unreachable!("{:?} {:?}", addr, size);
  }
  addr
}

fn alloc_struct<T>() -> *mut T {
  let size = std::mem::size_of::<T>();
  let offset = alloc(size as u32);
  unsafe { HEAP.as_mut_ptr().add(offset as usize) as *mut T }
}

fn heap_offset<T>(ptr: *const T) -> u32 {
  (ptr as usize - (unsafe { HEAP.as_ptr() } as *const _ as usize)) as u32
}

fn read_heap<T>(addr: u32) -> &'static mut T {
  unsafe {
    let ptr = HEAP.as_mut_ptr().add(addr as usize) as *mut T;
    &mut *ptr
  }
}

fn allocate_layout(layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
  let offset = alloc(layout.size() as u32);
  let ptr = unsafe { HEAP.as_mut_ptr().add(offset as usize) };
  unsafe {
    Ok(NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(
      ptr,
      layout.size(),
    )))
  }
}

pub struct Alloc;

unsafe impl Allocator for Alloc {
  #[inline(always)]
  fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
    allocate_layout(layout)
  }

  #[inline(always)]
  fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
    allocate_layout(layout)
  }

  unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {}
}

#[derive(Default)]
pub struct ParcelDb {
  environments: RwLock<Vec<*const Environment>>,
}

unsafe impl Sync for ParcelDb {}

impl ParcelDb {
  pub const fn new() -> ParcelDb {
    ParcelDb {
      environments: RwLock::new(Vec::new()),
    }
  }

  pub fn heap(&self) -> (*mut u8, usize) {
    unsafe { (HEAP.as_mut_ptr(), HEAP.len()) }
  }

  pub fn alloc(&self, size: u32) -> u32 {
    alloc(size)
  }

  pub fn read_string<'a>(&self, addr: u32) -> &'static String {
    read_heap::<String>(addr)
  }

  pub fn write_string(&self, addr: u32, s: String) {
    let ptr: &mut Option<String> = read_heap(addr);
    *ptr = Some(s);
  }

  pub fn read_heap<T>(&self, addr: u32) -> &'static T {
    read_heap(addr)
  }

  pub fn extend_vec(&self, addr: u32, size: u32, count: u32) {
    // This will cast the vector to a Vec<u8>, extend it by the given number of bytes, and then cast it back to its original type.
    let vec: &mut Vec<u8, Alloc> = read_heap(addr);
    set_vec_len(
      vec,
      vec.len() * size as usize,
      vec.capacity() * size as usize,
    );
    vec.resize(vec.len() + size as usize * count as usize, 0);
    set_vec_len(
      vec,
      vec.len() / size as usize,
      vec.capacity() / size as usize,
    );
  }

  pub fn environment_id(&self, addr: u32) -> u32 {
    let env: &Environment = read_heap(addr);
    {
      if let Some(env) = self
        .environments
        .read()
        .unwrap()
        .iter()
        .find(|e| unsafe { &***e } == env)
      {
        return heap_offset(*env);
      }
    }

    let ptr = alloc_struct::<Environment>();
    unsafe { *ptr = env.clone() };
    self.environments.write().unwrap().push(ptr);
    heap_offset(ptr)
  }
}

struct VecRepr<T, A: Allocator> {
  pub buf: RawVecRepr<T, A>,
  pub len: usize,
}

struct RawVecRepr<T, A: Allocator> {
  pub ptr: NonNull<T>,
  pub cap: usize,
  pub alloc: A,
}

fn set_vec_len(vec: &mut Vec<u8, Alloc>, len: usize, cap: usize) {
  let repr = unsafe { &mut *(vec as *mut Vec<u8, Alloc> as *mut VecRepr<u8, Alloc>) };
  repr.len = len;
  repr.buf.cap = cap;
}

pub fn build() -> std::io::Result<()> {
  use std::io::Write;
  let mut file = std::fs::File::create("src/db.js")?;
  let c = std::mem::MaybeUninit::uninit();
  let p: *const VecRepr<u8, Alloc> = c.as_ptr();
  let u8_ptr = p as *const u8;
  let buf_offset =
    unsafe { (std::ptr::addr_of!((*p).buf.ptr) as *const u8).offset_from(u8_ptr) as usize };
  let len_offset =
    unsafe { (std::ptr::addr_of!((*p).len) as *const u8).offset_from(u8_ptr) as usize };
  let cap_offset =
    unsafe { (std::ptr::addr_of!((*p).buf.cap) as *const u8).offset_from(u8_ptr) as usize };
  write!(
    file,
    r#"// @flow
import binding from '../index';

const HEAP = binding.getHeap();
const HEAP_BASE = binding.getHeapBase();
const HEAP_u32 = new Uint32Array(HEAP.buffer);
const HEAP_u64 = new BigUint64Array(HEAP.buffer);

interface TypeAccessor<T> {{
  get(addr: number): T,
  set(addr: number, value: T): void
}}

class Vec<T> {{
  addr: number;
  size: number;
  accessor: TypeAccessor<T>;
  /*::
  @@iterator(): Iterator<T> {{ return ({{}}: any); }}
  */

  constructor(addr: number, size: number, accessor: TypeAccessor<T>) {{
    this.addr = addr;
    this.size = size;
    this.accessor = accessor;
  }}

  get length(): number {{
    return Number(HEAP_u64[(this.addr + {len_offset}) >> 3]);
  }}

  get capacity(): number {{
    return Number(HEAP_u64[(this.addr + {cap_offset}) >> 3]);
  }}

  get(index: number): T {{
    let bufAddr = Number(HEAP_u64[this.addr + {buf_offset} >> 3] - HEAP_BASE);
    return this.accessor.get(bufAddr + index * this.size);
  }}

  set(index: number, value: T): void {{
    if (index >= this.length) {{
      throw new Error(`Index out of bounds: ${{index}} >= ${{this.length}}`);
    }}
    let bufAddr = Number(HEAP_u64[this.addr + {buf_offset} >> 3] - HEAP_BASE);
    this.accessor.set(bufAddr + index * this.size, value);
  }}

  reserve(count: number): void {{
    if (this.length + count > this.capacity) {{
      binding.extendVec(this.addr, this.size, count);
    }} else {{
      HEAP_u64[(this.addr + {len_offset}) >> 3] += BigInt(count);
    }}
  }}

  push(value: T): void {{
    this.reserve(1);
    this.set(this.length - 1, value);
  }}

  extend(): T {{
    this.reserve(1);
    return this.get(this.length - 1);
  }}

  clear(): void {{
    // TODO: run Rust destructors?
    HEAP_u64[(this.addr + {len_offset}) >> 3] = 0n;
    HEAP_u64[(this.addr + {cap_offset}) >> 3] = 0n;
    HEAP_u64[this.addr + {buf_offset} >> 3] = 1n;
  }}

  // $FlowFixMe
  *[globalThis.Symbol.iterator]() {{
    for (let i = 0; i < this.length; i++) {{
      yield this.get(i);
    }}
  }}

  find(pred: (value: T) => boolean): ?T {{
    for (let value of this) {{
      if (pred(value)) {{
        return value;
      }}
    }}
  }}

  some(pred: (value: T) => boolean): boolean {{
    for (let value of this) {{
      if (pred(value)) {{
        return true;
      }}
    }}
    return false;
  }}
}}

"#,
    buf_offset = buf_offset,
    cap_offset = cap_offset,
    len_offset = len_offset
  )?;

  unsafe {
    for cb in &WRITE_CALLBACKS {
      cb(&mut file)?;
      write!(file, "\n")?;
    }
  }

  println!("Wrote db.js");
  Ok(())
}
