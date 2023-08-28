#![allow(non_snake_case)]
#![feature(thread_local)]

use std::ptr::NonNull;
use std::{marker::PhantomData, num::NonZeroU32, sync::RwLock};

use alloc::Slab;
use allocator_api2::alloc::Allocator;
use dashmap::DashMap;
use derivative::Derivative;
use lazy_static::lazy_static;
use parcel_derive::{JsValue, SlabAllocated, ToJs};

mod alloc;
mod atomics;

pub use alloc::{ARENA, HEAP};

pub use alloc::ArenaAllocator;
pub use allocator_api2::vec::Vec;

static mut WRITE_CALLBACKS: Vec<fn(&mut std::fs::File) -> std::io::Result<()>> = Vec::new();

trait ToJs {
  fn to_js() -> String;
}

trait JsValue {
  fn js_getter(addr: &str, offset: usize) -> String;
  fn js_setter(addr: &str, offset: usize, value: &str) -> String;
  fn ty() -> String;
}

pub trait SlabAllocated {
  fn alloc(count: u32) -> (u32, *mut Self);
  fn dealloc(addr: u32, count: u32);
}

impl JsValue for u8 {
  fn js_getter(addr: &str, offset: usize) -> String {
    format!("readU8({} + {})", addr, offset)
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    format!("writeU8({} + {}, {})", addr, offset, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for u32 {
  fn js_getter(addr: &str, offset: usize) -> String {
    format!("readU32({} + {})", addr, offset)
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    format!("writeU32({} + {}, {})", addr, offset, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for NonZeroU32 {
  fn js_getter(addr: &str, offset: usize) -> String {
    format!("readU32({} + {})", addr, offset)
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    format!("writeU32({} + {}, {})", addr, offset, value)
  }

  fn ty() -> String {
    "number".into()
  }
}

impl JsValue for bool {
  fn js_getter(addr: &str, offset: usize) -> String {
    format!("!!readU8({} + {})", addr, offset)
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    format!("writeU8({} + {}, {} ? 1 : 0)", addr, offset, value)
  }

  fn ty() -> String {
    "boolean".into()
  }
}

impl JsValue for InternedString {
  fn js_getter(addr: &str, offset: usize) -> String {
    format!("readCachedString(readU32({} + {}))", addr, offset)
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    // STRING_CACHE.set(this.addr + {addr}, {value});
    format!(
      "writeU32({} + {}, binding.getStringId({}))",
      addr, offset, value
    )
  }

  fn ty() -> String {
    "string".into()
  }
}

impl<T: JsValue, A: Allocator> JsValue for Vec<T, A> {
  fn js_getter(addr: &str, offset: usize) -> String {
    let size = std::mem::size_of::<T>();
    let ty = <T>::ty();
    format!(
      "new Vec({addr} + {offset}, {size}, {ty})",
      addr = addr,
      offset = offset,
      size = size,
      ty = ty
    )
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    let size = std::mem::size_of::<Vec<T, A>>();
    format!(
      "copy({value}.addr, {addr} + {offset}, {size});",
      addr = addr,
      offset = offset,
      size = size,
      value = value
    )
  }

  fn ty() -> String {
    format!("Vec<{}>", <T>::ty())
  }
}

fn uninit<T>() -> T {
  let mut v = std::mem::MaybeUninit::<T>::uninit();
  let slice =
    unsafe { std::slice::from_raw_parts_mut(v.as_mut_ptr() as *mut u8, std::mem::size_of::<T>()) };
  for b in slice {
    *b = 123;
  }
  unsafe { v.assume_init() }
}

fn enum_value_offset<T, U, Wrap: Fn(T) -> U, Unwrap: Fn(&U) -> &T>(
  wrap: Wrap,
  unwrap: Unwrap,
) -> usize {
  let v = wrap(uninit::<T>());
  let base = &v as *const _ as usize;
  let offset = (unwrap(&v) as *const _ as usize) - base;
  std::mem::forget(v);
  offset
}

fn option_offset<T>() -> usize {
  enum_value_offset::<T, _, _, _>(Some, |v| v.as_ref().unwrap())
}

fn discriminant<T, F: Fn(&T) -> bool>(v: T, matches: F) -> (usize, usize) {
  let mut value = v;
  let slice = unsafe {
    std::slice::from_raw_parts_mut(&mut value as *mut _ as *mut u8, std::mem::size_of::<T>())
  };

  let mut offset = 0;
  let mut size = 0;
  for (i, b) in slice.iter_mut().enumerate() {
    let v = *b;
    *b = 123;
    if !matches(&value) {
      if size == 0 {
        offset = i;
      }
      size += 1;
    }
    *b = v;
  }

  (offset, size)
}

fn discriminant_value<T>(v: T, offset: usize, size: usize) -> usize {
  unsafe {
    let ptr = (&v as *const _ as *const u8).add(offset);
    match size {
      1 => *ptr as usize,
      2 => *(ptr as *const u16) as usize,
      4 => *(ptr as *const u32) as usize,
      _ => unreachable!(),
    }
  }
}

fn option_discriminant<T>(addr: &str, offset: usize, operator: &str) -> Vec<String> {
  // This infers the byte pattern for None of a given type. Due to discriminant elision,
  // there may be no separate byte for the discriminant. Instead, the Rust compiler uses
  // "niche" values of the contained type that would otherwise be invalid.
  // https://github.com/rust-lang/unsafe-code-guidelines/blob/master/reference/src/layout/enums.md#discriminant-elision-on-option-like-enums
  // To find the byte pattern, we create a None value, and then try flipping all of the bytes
  // in the value to see if they have an effect on the Option discriminant.
  let mut none: Option<T> = None;
  let slice = unsafe {
    std::slice::from_raw_parts_mut(
      &mut none as *mut _ as *mut u8,
      std::mem::size_of::<Option<T>>(),
    )
  };
  let mut comparisons = Vec::new();
  let mut zeros = 0;
  let mut zero_offset = 0;
  for (i, b) in slice.iter_mut().enumerate() {
    let v = *b;
    *b = 123;
    if !none.is_none() {
      comparisons.push(if operator == "===" {
        format!(
          "readU8({} + {} + {:?}) {} {:?}",
          addr, offset, i, operator, v
        )
      } else {
        format!("writeU8({} + {} + {:?}, {:?})", addr, offset, i, v)
      });
      if v == 0 {
        if zeros == 0 {
          zero_offset = i;
        }
        zeros += 1;
      } else {
        zeros = 0;
      }
    }
    *b = v;
  }

  // Optimize subsequent zeros into a single 32 bit access instead of 4 individual byte accesses.
  if zeros == comparisons.len() {
    if zeros == 4 || zeros == 8 {
      comparisons.clear();
      comparisons.push(if operator == "===" {
        format!(
          "readU32({} + {} + {}) {} 0",
          addr, offset, zero_offset, operator
        )
      } else {
        format!("writeU32({} + {} + {}, 0)", addr, offset, zero_offset)
      });
      if zeros == 8 {
        comparisons.push(if operator == "===" {
          format!(
            "readU32({} + {} + {:?}) {} 0",
            addr,
            offset,
            zero_offset + 4,
            operator
          )
        } else {
          format!("writeU32({} + {} + {}, 0)", addr, offset, zero_offset + 4)
        })
      }
    }
  }

  comparisons
}

impl<T: JsValue> JsValue for Option<T> {
  fn js_getter(addr: &str, offset: usize) -> String {
    let value_offset = option_offset::<T>();
    if value_offset == 0 {
      let discriminant = option_discriminant::<T>(addr, offset, "===").join(" && ");
      format!("{} ? null : {}", discriminant, T::js_getter(addr, offset))
    } else {
      format!(
        "{} === 0 ? null : {}",
        match value_offset {
          1 => u8::js_getter(addr, offset),
          4 => u32::js_getter(addr, offset),
          _ => todo!(),
        },
        T::js_getter(addr, offset + value_offset)
      )
    }
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    // TODO: run Rust destructors when setting to null...
    let value_offset = option_offset::<T>();
    if value_offset == 0 {
      return format!(
        r#"if (value == null) {{
      {set_none};
    }} else {{
      {setter};
    }}"#,
        set_none = option_discriminant::<T>(addr, offset, "=").join(";\n      "),
        setter = T::js_setter(addr, offset, value),
      );
    }

    format!(
      r#"{};
    if (value != null) {}"#,
      match value_offset {
        1 => u8::js_setter(addr, offset, "value == null ? 0 : 1"),
        4 => u32::js_setter(addr, offset, "value == null ? 0 : 1"),
        _ => todo!(),
      },
      T::js_setter(addr, offset + value_offset, value)
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
      fn js_getter(addr: &str, offset: usize) -> String {
        <$T>::js_getter(addr, offset)
      }

      fn js_setter(addr: &str, offset: usize, value: &str) -> String {
        <$T>::js_setter(addr, offset, value)
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

#[derive(Clone)]
struct SlabAllocator<T> {
  phantom: PhantomData<T>,
}

impl<T> SlabAllocator<T> {
  fn new() -> Self {
    Self {
      phantom: PhantomData,
    }
  }
}

unsafe impl<T: SlabAllocated> Allocator for SlabAllocator<T> {
  fn allocate(
    &self,
    layout: std::alloc::Layout,
  ) -> Result<std::ptr::NonNull<[u8]>, allocator_api2::alloc::AllocError> {
    let size = std::mem::size_of::<T>();
    let count = layout.size() / size;
    let (_, ptr) = T::alloc(count as u32);
    unsafe {
      Ok(NonNull::new_unchecked(core::slice::from_raw_parts_mut(
        ptr as *mut u8,
        size,
      )))
    }
  }

  unsafe fn deallocate(&self, ptr: std::ptr::NonNull<u8>, layout: std::alloc::Layout) {
    let size = std::mem::size_of::<T>();
    let count = layout.size() / size;
    let addr = HEAP.find_page(ptr.as_ptr()).unwrap();
    T::dealloc(addr, count as u32);
  }
}

pub struct ArenaVec<T> {
  buf: u32,
  len: u32,
  cap: u32,
  phantom: PhantomData<T>,
}

impl<T: SlabAllocated + Clone> Clone for ArenaVec<T> {
  fn clone(&self) -> Self {
    let vec = unsafe { self.as_vec() }.clone();
    let mut res = Self::new();
    unsafe {
      res.update(vec);
    }
    res
  }
}

impl<T: PartialEq + SlabAllocated> PartialEq for ArenaVec<T> {
  fn eq(&self, other: &Self) -> bool {
    self.as_slice().eq(other.as_slice())
  }
}

impl<T: SlabAllocated> ArenaVec<T> {
  pub fn new() -> Self {
    Self {
      buf: 0,
      len: 0,
      cap: 0,
      phantom: PhantomData,
    }
  }

  unsafe fn as_vec(&self) -> Vec<T, SlabAllocator<T>> {
    let ptr = HEAP.get(self.buf);
    Vec::from_raw_parts_in(
      ptr,
      self.len as usize,
      self.cap as usize,
      SlabAllocator::new(),
    )
  }

  unsafe fn update(&mut self, vec: Vec<T, SlabAllocator<T>>) {
    self.buf = HEAP.find_page(vec.as_ptr() as *const u8).unwrap();
    self.len = vec.len() as u32;
    self.cap = vec.capacity() as u32;
    std::mem::forget(vec)
  }

  pub fn push(&mut self, value: T) {
    unsafe {
      let mut vec = self.as_vec();
      vec.push(value);
      self.update(vec);
    }
  }

  pub fn as_slice(&self) -> &[T] {
    unsafe {
      let ptr = HEAP.get(self.buf);
      std::slice::from_raw_parts(ptr, self.len as usize)
    }
  }

  pub fn reserve(&mut self, count: usize) {
    unsafe {
      let mut vec = self.as_vec();
      vec.reserve(count);
      self.update(vec)
    }
  }

  pub fn len(&self) -> u32 {
    self.len
  }

  pub fn is_empty(&self) -> bool {
    self.len == 0
  }
}

impl<T: std::fmt::Debug + SlabAllocated + Clone> std::fmt::Debug for ArenaVec<T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_slice().fmt(f)
  }
}

impl<T: JsValue> JsValue for ArenaVec<T> {
  fn js_getter(addr: &str, offset: usize) -> String {
    let size = std::mem::size_of::<T>();
    let ty = <T>::ty();
    format!(
      "new Vec({addr} + {offset}, {size}, {ty})",
      addr = addr,
      offset = offset,
      size = size,
      ty = ty
    )
  }

  fn js_setter(addr: &str, offset: usize, value: &str) -> String {
    let size = std::mem::size_of::<ArenaVec<T>>();
    format!(
      "copy({value}.addr, {addr} + {offset}, {size});",
      addr = addr,
      offset = offset,
      size = size,
      value = value
    )
  }

  fn ty() -> String {
    format!("Vec<{}>", <T>::ty())
  }
}

#[derive(PartialEq, Eq, Clone, Copy, PartialOrd, Ord, Hash)]
pub struct InternedString(pub NonZeroU32);

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct FileId(u32);

#[derive(PartialEq, Clone, Debug, JsValue)]
pub struct TargetId(pub u32);

#[derive(PartialEq, Debug, ToJs)]
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

#[derive(PartialEq, Clone, Debug, JsValue)]
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

#[derive(PartialEq, Clone, Debug, ToJs, JsValue)]
pub struct TargetSourceMapOptions {
  source_root: Option<InternedString>,
  inline: bool,
  inline_sources: bool,
}

#[derive(PartialEq, Debug, Clone, ToJs, JsValue)]
pub struct SourceLocation {
  pub file_path: InternedString,
  pub start: Location,
  pub end: Location,
}

#[derive(PartialEq, Debug, Clone, ToJs, JsValue)]
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
  pub file_path: InternedString,
  pub env: EnvironmentId,
  pub query: Option<InternedString>,
  pub asset_type: AssetType,
  pub content_key: InternedString,
  pub map_key: Option<InternedString>,
  pub output_hash: InternedString,
  pub pipeline: Option<InternedString>,
  pub meta: InternedString,
  pub stats: AssetStats,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub symbols: ArenaVec<Symbol>,
  pub unique_key: Option<InternedString>,
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

#[derive(Debug, Clone, Default, ToJs, JsValue)]
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
  // meta/resolver_meta
  // pipeline
  pub placeholder: Option<InternedString>,
  pub target: TargetId,
  pub symbols: ArenaVec<Symbol>,
  pub promise_symbol: Option<InternedString>,
  pub import_attributes: ArenaVec<ImportAttribute>,
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

fn alloc_struct<T>() -> (u32, *mut T) {
  let size = std::mem::size_of::<T>();
  let addr = ARENA.alloc(size as u32);
  let ptr = unsafe { HEAP.get(addr) };
  (addr, ptr)
}

lazy_static! {
  static ref STRINGS: DashMap<&'static str, NonZeroU32> = DashMap::new();
}

impl From<String> for InternedString {
  fn from(value: String) -> Self {
    if let Some(v) = STRINGS.get(value.as_str()) {
      // println!("FOUND EXISTING");
      return InternedString(*v);
    }

    // TODO: memory leak
    let mut bytes = value.into_bytes();
    bytes.shrink_to_fit();
    let s = unsafe { std::str::from_utf8_unchecked(bytes.leak()) };
    let (addr, ptr) = alloc_struct();
    unsafe { std::ptr::write(ptr, s) };
    let offset = unsafe { NonZeroU32::new_unchecked(addr) };
    STRINGS.insert(unsafe { *ptr }, offset);
    // println!("NEW STRING {:?}", STRINGS.len());
    InternedString(offset)
  }
}

impl From<&str> for InternedString {
  fn from(value: &str) -> Self {
    if let Some(v) = STRINGS.get(value) {
      return InternedString(*v);
    }

    InternedString::from(String::from(value))
  }
}

impl InternedString {
  pub fn get(s: &str) -> Option<InternedString> {
    STRINGS.get(s).map(|s| InternedString(*s))
  }

  pub fn as_str(&self) -> &'static str {
    unsafe { &*HEAP.get::<&str>(self.0.get()) }
  }
}

impl<T: AsRef<str>> PartialEq<T> for InternedString {
  fn eq(&self, other: &T) -> bool {
    matches!(InternedString::get(other.as_ref()), Some(s) if s == *self)
  }
}

impl core::ops::Deref for InternedString {
  type Target = str;

  fn deref(&self) -> &str {
    self.as_str()
  }
}

impl std::fmt::Debug for InternedString {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_str().fmt(f)
  }
}

#[derive(Default)]
pub struct ParcelDb {
  environments: RwLock<Vec<u32>>,
}

unsafe impl Sync for ParcelDb {}

impl ParcelDb {
  pub const fn new() -> ParcelDb {
    ParcelDb {
      environments: RwLock::new(Vec::new()),
    }
  }

  pub fn heap_page(&self, page: u32) -> &'static mut [u8] {
    unsafe { crate::alloc::HEAP.get_page(page) }
  }

  pub fn find_page(&self, ptr: *const u8) -> Option<u32> {
    unsafe { crate::alloc::HEAP.find_page(ptr) }
  }

  pub fn alloc(&self, size: u32) -> u32 {
    ARENA.alloc(size)
  }

  pub fn alloc_struct<T>(&self) -> (u32, &'static mut T) {
    unsafe {
      let (addr, ptr) = alloc_struct();
      (addr, &mut *ptr)
    }
  }

  pub fn read_string<'a>(&self, addr: u32) -> &'static str {
    unsafe { InternedString(NonZeroU32::new_unchecked(addr)).as_str() }
  }

  pub fn read_heap<T>(&self, addr: u32) -> &'static mut T {
    unsafe { &mut *HEAP.get(addr) }
  }

  pub fn extend_vec(&self, addr: u32, size: u32, count: u32) {
    // TODO: handle different types of vectors...
    let vec: &mut ArenaVec<Symbol> = unsafe { &mut *HEAP.get(addr) };
    vec.reserve(count as usize);
  }

  pub fn get_environment(&self, addr: u32) -> &Environment {
    unsafe { &*HEAP.get(addr) }
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

    let (addr, ptr) = Environment::alloc(1);
    unsafe { *ptr = env.clone() };
    self.environments.write().unwrap().push(addr);
    EnvironmentId(addr)
  }

  pub fn create_dependency(&self, dep: Dependency) -> u32 {
    let (addr, ptr) = Dependency::alloc(1);
    unsafe { std::ptr::write(ptr, dep) };
    addr
  }
}

pub fn build() -> std::io::Result<()> {
  use std::io::Write;
  let mut file = std::fs::File::create("src/db.js")?;
  let c = std::mem::MaybeUninit::uninit();
  let p: *const ArenaVec<u8> = c.as_ptr();
  let u8_ptr = p as *const u8;
  let buf_offset =
    unsafe { (std::ptr::addr_of!((*p).buf) as *const u8).offset_from(u8_ptr) as usize };
  let len_offset =
    unsafe { (std::ptr::addr_of!((*p).len) as *const u8).offset_from(u8_ptr) as usize };
  let cap_offset =
    unsafe { (std::ptr::addr_of!((*p).cap) as *const u8).offset_from(u8_ptr) as usize };
  write!(
    file,
    r#"// @flow
import binding from '../index';

const HEAP = [];
const HEAP_u32 = [];
const STRING_CACHE = new Map();

const PAGE_INDEX_SIZE = 16;
const PAGE_INDEX_SHIFT = 32 - PAGE_INDEX_SIZE;
const PAGE_INDEX_MASK = ((1 << PAGE_INDEX_SIZE) - 1) << PAGE_INDEX_SHIFT;
const PAGE_OFFSET_MASK = (1 << PAGE_INDEX_SHIFT) - 1;

function copy(from: number, to: number, size: number) {{
  let fromPage = (from & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let fromOffset = from & PAGE_OFFSET_MASK;
  let fromHeapPage = HEAP[fromPage] ??= binding.getPage(fromPage);
  let toPage = (to & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let toOffset = to & PAGE_OFFSET_MASK;
  let toHeapPage = HEAP[toPage] ??= binding.getPage(toPage);
  toHeapPage.set(fromHeapPage.subarray(fromOffset, fromOffset + size), toOffset);
}}

function readU8(addr: number): number {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP[page] ??= binding.getPage(page);
  return heapPage[offset];
}}

function writeU8(addr: number, value: number) {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP[page] ??= binding.getPage(page);
  return heapPage[offset] = value;
}}

function readU32(addr: number): number {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP_u32[page] ??= new Uint32Array((HEAP[page] ??= binding.getPage(page)).buffer);
  return heapPage[offset >> 2];
}}

function writeU32(addr: number, value: number) {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heapPage = HEAP_u32[page] ??= new Uint32Array((HEAP[page] ??= binding.getPage(page)).buffer);
  return heapPage[offset >> 2] = value;
}}

export function readCachedString(addr: number): string {{
  let v = STRING_CACHE.get(addr);
  if (v != null) return v;
  v = binding.readString(addr);
  STRING_CACHE.set(addr, v);
  return v;
}}

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
    return readU32(this.addr + {len_offset});
  }}

  get capacity(): number {{
    return readU32(this.addr + {cap_offset});
  }}

  get(index: number): T {{
    let bufAddr = readU32(this.addr + {buf_offset});
    return this.accessor.get(bufAddr + index * this.size);
  }}

  set(index: number, value: T): void {{
    if (index >= this.length) {{
      throw new Error(`Index out of bounds: ${{index}} >= ${{this.length}}`);
    }}
    let bufAddr = readU32(this.addr + {buf_offset});
    this.accessor.set(bufAddr + index * this.size, value);
  }}

  reserve(count: number): void {{
    if (this.length + count > this.capacity) {{
      binding.extendVec(this.addr, this.size, count);
    }}
  }}

  push(value: T): void {{
    this.reserve(1);
    writeU32(this.addr + {len_offset}, readU32(this.addr + {len_offset}) + 1);
    this.set(this.length - 1, value);
  }}

  extend(): T {{
    this.reserve(1);
    writeU32(this.addr + {len_offset}, readU32(this.addr + {len_offset}) + 1);
    return this.get(this.length - 1);
  }}

  clear(): void {{
    // TODO: run Rust destructors?
    writeU32(this.addr + {len_offset}, 0);
  }}

  init(): void {{
    writeU32(this.addr + {len_offset}, 0);
    writeU32(this.addr + {cap_offset}, 0);
    writeU32(this.addr + {buf_offset}, 0);
  }}

  // $FlowFixMe
  *[globalThis.Symbol.iterator]() {{
    let addr = readU32(this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      yield this.accessor.get(addr);
    }}
  }}

  find(pred: (value: T) => mixed): ?T {{
    let addr = readU32(this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(addr);
      if (pred(value)) {{
        return value;
      }}
    }}
  }}

  some(pred: (value: T) => mixed): boolean {{
    let addr = readU32(this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(addr);
      if (pred(value)) {{
        return true;
      }}
    }}
    return false;
  }}

  every(pred: (value: T) => mixed): boolean {{
    let addr = readU32(this.addr + {buf_offset});
    for (let i = 0, len = this.length; i < len; i++, addr += this.size) {{
      let value = this.accessor.get(addr);
      if (!pred(value)) {{
        return false;
      }}
    }}
    return true;
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
