#![allow(non_camel_case_types)]

use libloading::{Library, Symbol};
use std::{borrow::Cow, ffi::c_void, mem::ManuallyDrop, path::Path, ptr, sync::Arc};

use parcel_core::{
  Asset as CoreAsset, AssetFlags as CoreAssetFlags, AssetIndex as CoreAssetIndex, AssetRequest,
  AssetType, BufferContent, BundleBehavior as CoreBundleBehavior, BundleFlags as CoreBundleFlags,
  BundleGraphDependencyResolution as CoreBundleGraphDependencyResolution, CodeFrame, CodeHighlight,
  Content, ContentType, Dependency as CoreDependency, DependencyFlags as CoreDependencyFlags,
  DependencyResolution, Diagnostic as CoreDiagnostic, DiagnosticList,
  DiagnosticSeverity as CoreDiagnosticSeverity, EnvironmentFlags as CoreEnvironmentFlags,
  ExportsCondition as CoreExportsCondition, FileContent, LocalSymbol, Location, ParcelOptions,
  PathId, Priority as CorePriority, Resolver, SourceLocation, SourceUrl,
  SpecifierType as CoreSpecifierType, SymbolName, Transformer,
};

// ── Opaque handle type aliases ────────────────────────────────────────────────
// cbindgen emits these as: typedef uint64_t Asset; etc.

/// Opaque handle to a Parcel asset. Pass to `parcel_asset_*` functions.
pub type Asset = u64;
/// Opaque handle to a Parcel target. Obtained via `parcel_asset_get_target()`.
pub type Target = u64;
/// Opaque handle to a Parcel dependency. Passed to `parcel_plugin_resolve()`.
pub type Dependency = u64;
/// Opaque handle to Parcel build options. Passed to all plugin entry points.
pub type Options = u64;
/// Opaque handle to Parcel bundle graph.
pub type BundleGraph = u64;
/// Opaque handle to Parcel bundle.
pub type Bundle = u64;
/// Index of an asset within the bundle graph.
pub type AssetIndex = u32;
/// Index of a bundle within the bundle graph.
pub type BundleIndex = usize;

pub const PARCEL_INVALID_ASSET_INDEX: AssetIndex = 0xffff_ffff;

// ── Constants ─────────────────────────────────────────────────────────────────

// SpecifierType — how a dependency specifier is interpreted
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum SpecifierType {
  PARCEL_SPECIFIER_ESM = 0,
  PARCEL_SPECIFIER_COMMONJS = 1,
  PARCEL_SPECIFIER_URL = 2,
  PARCEL_SPECIFIER_CUSTOM = 3,
}

// Priority — when a dependency is loaded
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum Priority {
  PARCEL_PRIORITY_SYNC = 0,
  PARCEL_PRIORITY_PARALLEL = 1,
  PARCEL_PRIORITY_LAZY = 2,
}

// BundleBehavior
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum BundleBehavior {
  PARCEL_BUNDLE_BEHAVIOR_NONE = 0,
  PARCEL_BUNDLE_BEHAVIOR_INLINE = 1,
  PARCEL_BUNDLE_BEHAVIOR_ISOLATED = 2,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum DependencyFlags {
  PARCEL_DEP_ENTRY = 1 << 0,
  PARCEL_DEP_OPTIONAL = 1 << 1,
  PARCEL_DEP_NEEDS_STABLE_NAME = 1 << 2,
  PARCEL_DEP_IS_WEBWORKER = 1 << 3,
  PARCEL_DEP_SIDE_EFFECTS = 1 << 4,
  PARCEL_DEP_MACRO = 1 << 5,
}

pub type DependencyFlagsFFI = u8;

/// Conditions used when resolving package `exports` and `imports` fields.
#[repr(u32)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum ExportsConditions {
  PARCEL_EXPORTS_CONDITION_IMPORT = 1 << 0,
  PARCEL_EXPORTS_CONDITION_REQUIRE = 1 << 1,
  PARCEL_EXPORTS_CONDITION_MODULE = 1 << 2,
  PARCEL_EXPORTS_CONDITION_NODE = 1 << 3,
  PARCEL_EXPORTS_CONDITION_BROWSER = 1 << 4,
  PARCEL_EXPORTS_CONDITION_WORKER = 1 << 5,
  PARCEL_EXPORTS_CONDITION_WORKLET = 1 << 6,
  PARCEL_EXPORTS_CONDITION_ELECTRON = 1 << 7,
  PARCEL_EXPORTS_CONDITION_DEVELOPMENT = 1 << 8,
  PARCEL_EXPORTS_CONDITION_PRODUCTION = 1 << 9,
  PARCEL_EXPORTS_CONDITION_TYPES = 1 << 10,
  PARCEL_EXPORTS_CONDITION_DEFAULT = 1 << 11,
  PARCEL_EXPORTS_CONDITION_STYLE = 1 << 12,
  PARCEL_EXPORTS_CONDITION_SASS = 1 << 13,
  PARCEL_EXPORTS_CONDITION_LESS = 1 << 14,
  PARCEL_EXPORTS_CONDITION_STYLUS = 1 << 15,
  PARCEL_EXPORTS_CONDITION_REACT_SERVER = 1 << 16,
  PARCEL_EXPORTS_CONDITION_SOURCE = 1 << 17,
}

pub type ExportsConditionsFFI = u32;

#[repr(u32)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum AssetFlags {
  PARCEL_ASSET_IS_SOURCE = 1 << 0,
  PARCEL_ASSET_SIDE_EFFECTS = 1 << 1,
  PARCEL_ASSET_IS_BUNDLE_SPLITTABLE = 1 << 2,
  PARCEL_ASSET_LARGE_BLOB = 1 << 3,
  PARCEL_ASSET_HAS_CJS_EXPORTS = 1 << 4,
  PARCEL_ASSET_STATIC_EXPORTS = 1 << 5,
  PARCEL_ASSET_SHOULD_WRAP = 1 << 6,
  PARCEL_ASSET_IS_CONSTANT_MODULE = 1 << 7,
  PARCEL_ASSET_HAS_NODE_REPLACEMENTS = 1 << 8,
  PARCEL_ASSET_HAS_SYMBOLS = 1 << 9,
  PARCEL_ASSET_IS_HTML_ATTR = 1 << 10,
  PARCEL_ASSET_IS_HTML_TAG = 1 << 11,
  PARCEL_ASSET_IS_ESM = 1 << 12,
}

pub type AssetFlagsFFI = u32;

#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum BundleFlags {
  PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME = 1 << 0,
  PARCEL_BUNDLE_FLAG_IS_SPLITTABLE = 1 << 1,
  PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER = 1 << 2,
  PARCEL_BUNDLE_FLAG_ENTRY = 1 << 3,
}

pub type BundleFlagsFFI = u8;

#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq, Default)]
pub enum BundleGraphResolutionType {
  #[default]
  PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID = 0,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE = 1,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED = 2,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL = 3,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED = 4,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET = 5,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE = 6,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct BundleGraphDependencyResolution {
  /// `PARCEL_BUNDLE_GRAPH_RESOLUTION_*`
  pub resolution_type: BundleGraphResolutionType,
  /// Valid only when `resolution_type == PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET`.
  pub asset: AssetIndex,
  /// Valid only when `resolution_type == PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE`.
  pub bundle: BundleIndex,
}

impl Default for BundleGraphDependencyResolution {
  fn default() -> Self {
    Self {
      resolution_type: BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID,
      asset: PARCEL_INVALID_ASSET_INDEX,
      bundle: 0,
    }
  }
}

// Environment (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum Environment {
  PARCEL_ENV_BROWSER = 0,
  PARCEL_ENV_WEB_WORKER = 1,
  PARCEL_ENV_SERVICE_WORKER = 2,
  PARCEL_ENV_WORKLET = 3,
  PARCEL_ENV_NODE = 4,
  PARCEL_ENV_ELECTRON_MAIN = 5,
  PARCEL_ENV_ELECTRON_RENDERER = 6,
  PARCEL_ENV_REACT_CLIENT = 7,
  PARCEL_ENV_REACT_SERVER = 8,
}

// OutputFormat (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum OutputFormat {
  PARCEL_OUTPUT_FORMAT_GLOBAL = 0,
  PARCEL_OUTPUT_FORMAT_COMMONJS = 1,
  PARCEL_OUTPUT_FORMAT_ESMODULE = 2,
}

// SourceType (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum SourceType {
  PARCEL_SOURCE_TYPE_MODULE = 0,
  PARCEL_SOURCE_TYPE_SCRIPT = 1,
}

// EnvironmentFlags (target, read-only) — bitfield
#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum EnvironmentFlags {
  PARCEL_ENV_FLAG_IS_LIBRARY = 1 << 0,
  PARCEL_ENV_FLAG_SHOULD_OPTIMIZE = 1 << 1,
  PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST = 1 << 2,
  PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION = 1 << 3,
}

pub type EnvironmentFlagsFFI = u8;

// DiagnosticSeverity — CDiagnostic.severity field
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq, Default)]
pub enum DiagnosticSeverity {
  #[default]
  PARCEL_SEVERITY_ERROR = 0,
  PARCEL_SEVERITY_WARNING = 1,
  PARCEL_SEVERITY_SOURCE_ERROR = 2,
  PARCEL_SEVERITY_INFO = 3,
}

// ResolveResult.resolution_type field
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum ResolutionType {
  PARCEL_RESOLUTION_NONE = 0,
  PARCEL_RESOLUTION_FILE_PATH = 1,
  PARCEL_RESOLUTION_EXTERNAL = 2,
  PARCEL_RESOLUTION_EXCLUDED = 3,
}

// ── Compile-time sync checks ──────────────────────────────────────────────────
// If parcel_core changes a bitflag bit, these fire.

const _: () =
  debug_assert!(CoreDependencyFlags::ENTRY.bits() == DependencyFlags::PARCEL_DEP_ENTRY as u8);
const _: () =
  debug_assert!(CoreDependencyFlags::OPTIONAL.bits() == DependencyFlags::PARCEL_DEP_OPTIONAL as u8);
const _: () = debug_assert!(
  CoreDependencyFlags::NEEDS_STABLE_NAME.bits()
    == DependencyFlags::PARCEL_DEP_NEEDS_STABLE_NAME as u8
);
const _: () = debug_assert!(
  CoreDependencyFlags::IS_WEBWORKER.bits() == DependencyFlags::PARCEL_DEP_IS_WEBWORKER as u8
);
const _: () = debug_assert!(
  CoreDependencyFlags::SIDE_EFFECTS.bits() == DependencyFlags::PARCEL_DEP_SIDE_EFFECTS as u8
);
const _: () =
  debug_assert!(CoreDependencyFlags::MACRO.bits() == DependencyFlags::PARCEL_DEP_MACRO as u8);

const _: () = debug_assert!(
  CoreExportsCondition::IMPORT.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_IMPORT as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::REQUIRE.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_REQUIRE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::MODULE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_MODULE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::NODE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_NODE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::BROWSER.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_BROWSER as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::WORKER.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_WORKER as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::WORKLET.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_WORKLET as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::ELECTRON.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_ELECTRON as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::DEVELOPMENT.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_DEVELOPMENT as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::PRODUCTION.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_PRODUCTION as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::TYPES.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_TYPES as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::DEFAULT.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_DEFAULT as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::STYLE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_STYLE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::SASS.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_SASS as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::LESS.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_LESS as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::STYLUS.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_STYLUS as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::REACT_SERVER.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_REACT_SERVER as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::SOURCE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_SOURCE as u32
);

const _: () =
  debug_assert!(CoreAssetFlags::IS_SOURCE.bits() == AssetFlags::PARCEL_ASSET_IS_SOURCE as u32);
const _: () = debug_assert!(
  CoreAssetFlags::SIDE_EFFECTS.bits() == AssetFlags::PARCEL_ASSET_SIDE_EFFECTS as u32
);
const _: () = debug_assert!(
  CoreAssetFlags::IS_BUNDLE_SPLITTABLE.bits()
    == AssetFlags::PARCEL_ASSET_IS_BUNDLE_SPLITTABLE as u32
);
const _: () =
  debug_assert!(CoreAssetFlags::LARGE_BLOB.bits() == AssetFlags::PARCEL_ASSET_LARGE_BLOB as u32);
const _: () = debug_assert!(
  CoreAssetFlags::HAS_CJS_EXPORTS.bits() == AssetFlags::PARCEL_ASSET_HAS_CJS_EXPORTS as u32
);
const _: () = debug_assert!(
  CoreAssetFlags::STATIC_EXPORTS.bits() == AssetFlags::PARCEL_ASSET_STATIC_EXPORTS as u32
);
const _: () =
  debug_assert!(CoreAssetFlags::SHOULD_WRAP.bits() == AssetFlags::PARCEL_ASSET_SHOULD_WRAP as u32);
const _: () = debug_assert!(
  CoreAssetFlags::IS_CONSTANT_MODULE.bits() == AssetFlags::PARCEL_ASSET_IS_CONSTANT_MODULE as u32
);
const _: () = debug_assert!(
  CoreAssetFlags::HAS_NODE_REPLACEMENTS.bits()
    == AssetFlags::PARCEL_ASSET_HAS_NODE_REPLACEMENTS as u32
);
const _: () =
  debug_assert!(CoreAssetFlags::HAS_SYMBOLS.bits() == AssetFlags::PARCEL_ASSET_HAS_SYMBOLS as u32);
const _: () = debug_assert!(
  CoreAssetFlags::IS_HTML_ATTR.bits() == AssetFlags::PARCEL_ASSET_IS_HTML_ATTR as u32
);
const _: () =
  debug_assert!(CoreAssetFlags::IS_HTML_TAG.bits() == AssetFlags::PARCEL_ASSET_IS_HTML_TAG as u32);
const _: () =
  debug_assert!(CoreAssetFlags::IS_ESM.bits() == AssetFlags::PARCEL_ASSET_IS_ESM as u32);

const _: () = debug_assert!(
  CoreEnvironmentFlags::IS_LIBRARY.bits() == EnvironmentFlags::PARCEL_ENV_FLAG_IS_LIBRARY as u8
);
const _: () = debug_assert!(
  CoreEnvironmentFlags::SHOULD_OPTIMIZE.bits()
    == EnvironmentFlags::PARCEL_ENV_FLAG_SHOULD_OPTIMIZE as u8
);
const _: () = debug_assert!(
  CoreEnvironmentFlags::SHOULD_SCOPE_HOIST.bits()
    == EnvironmentFlags::PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST as u8
);
const _: () = debug_assert!(
  CoreEnvironmentFlags::MODULE_TYPE_EXTENSION.bits()
    == EnvironmentFlags::PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION as u8
);

const _: () = debug_assert!(
  CoreBundleFlags::NEEDS_STABLE_NAME.bits()
    == BundleFlags::PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME as u8
);
const _: () = debug_assert!(
  CoreBundleFlags::IS_SPLITTABLE.bits() == BundleFlags::PARCEL_BUNDLE_FLAG_IS_SPLITTABLE as u8
);
const _: () = debug_assert!(
  CoreBundleFlags::IS_PLACEHOLDER.bits() == BundleFlags::PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER as u8
);
const _: () =
  debug_assert!(CoreBundleFlags::ENTRY.bits() == BundleFlags::PARCEL_BUNDLE_FLAG_ENTRY as u8);

// ── Buffer ────────────────────────────────────────────────────────────────────

unsafe fn bytes_to_str<'a>(data: *const u8, len: usize) -> &'a str {
  if data.is_null() || len == 0 {
    return "";
  }
  unsafe { std::str::from_utf8(std::slice::from_raw_parts(data, len)).unwrap_or("") }
}

/// Byte buffer owned by Parcel.
/// Plugins may allocate a buffer with `parcel_buffer_alloc` and release with `parcel_free_buffer()`.
/// Use `parcel_buffer_write` or `parcel_buffer_write_utf8` to copy data into an existing Buffer,
/// replacing and dropping the existing content if any. Do not set the fields in this struct manually.
#[repr(C)]
#[derive(Default)]
pub struct Buffer {
  pub data: *mut u8,
  pub len: usize,
  pub cap: usize,
  pub is_utf8: bool,
}

unsafe fn write_buffer(buffer: *mut Buffer, mut bytes: Vec<u8>, is_utf8: bool) {
  unsafe {
    (*buffer).data = bytes.as_mut_ptr();
    (*buffer).len = bytes.len();
    (*buffer).cap = bytes.capacity();
    (*buffer).is_utf8 = is_utf8;
  }
  std::mem::forget(bytes);
}

/// Dependency descriptor passed to `parcel_asset_add_dependency()`.
/// Use `PARCEL_SPECIFIER_ESM` / `PARCEL_PRIORITY_SYNC` / `PARCEL_BUNDLE_BEHAVIOR_NONE` as defaults.
#[repr(C)]
pub struct DependencyOptions {
  /// Module specifier bytes (e.g. `"./foo.js"`). Required.
  pub specifier: *const u8,
  /// Byte length of `specifier`.
  pub specifier_len: usize,
  /// `PARCEL_SPECIFIER_*`
  pub specifier_type: SpecifierType,
  /// `PARCEL_PRIORITY_*`
  pub priority: Priority,
  /// `PARCEL_BUNDLE_BEHAVIOR_*`
  pub bundle_behavior: BundleBehavior,
  /// `PARCEL_DEP_*` bits
  pub flags: DependencyFlagsFFI,
  /// `PARCEL_EXPORTS_CONDITION_*` bits
  pub conditions: ExportsConditionsFFI,
}

/// Result filled by a resolver plugin's `parcel_plugin_resolve()`.
/// The struct is zero-initialised by the host before the call.
///
/// When type == PARCEL_RESOLUTION_FILE_PATH, fill `file_path` (and optionally `pipeline`) via `parcel_buffer_alloc()`.
#[repr(C)]
pub struct ResolveResult {
  /// `PARCEL_RESOLUTION_*`
  pub resolution_type: ResolutionType,
  pub file_path: Buffer,
  pub pipeline: Buffer,
}

/// Diagnostic written by a plugin to report an error or warning.
/// The host zero-initialises this before every plugin call.
/// Fill via `parcel_buffer_alloc()`; host frees all `Buffer` fields after the call.
/// If `message.data == NULL` after the call, no diagnostic was set.
#[repr(C)]
#[derive(Default)]
pub struct Diagnostic {
  pub message: Buffer,
  pub file_path: Buffer,
  pub line: u32,
  pub column: u32,
  pub hint: Buffer,
  /// `PARCEL_SEVERITY_*`
  pub severity: DiagnosticSeverity,
}

// ── Buffer functions ──────────────────────────────────────────────────────────

/// Release a `Buffer` previously filled by a getter or `parcel_buffer_alloc()`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_free_buffer(buf: *mut Buffer) {
  if buf.is_null() {
    return;
  }
  let b = unsafe { &*buf };
  if !b.data.is_null() {
    drop(unsafe { Vec::from_raw_parts(b.data, b.len, b.cap) });
  }
}

/// Allocates a new `Buffer` containing a copy of `[data, data+len)`.
/// The plugin calls this to fill `ResolveResult` or `Diagnostic` fields.
/// Returns a zero `Buffer` when `data` is NULL or `len` is 0.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_buffer_alloc(data: *const u8, len: usize) -> Buffer {
  let mut buf = Buffer::default();
  parcel_buffer_write(&mut buf, data, len);
  buf
}

/// Copies the given bytes into a `Buffer`, replacing the existing content if any.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_buffer_write(buf: *mut Buffer, data: *const u8, len: usize) {
  parcel_buffer_write_inner(buf, data, len, false);
}

/// Copies the given UTF-8 encoded string into a `Buffer`, replacing the existing content if any.
/// It is the caller's responsibility to ensure that the UTF-8 data is valid.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_buffer_write_utf8(buf: *mut Buffer, data: *const u8, len: usize) {
  parcel_buffer_write_inner(buf, data, len, true);
}

fn parcel_buffer_write_inner(buf: *mut Buffer, data: *const u8, len: usize, is_utf8: bool) {
  if data.is_null() {
    return;
  }

  unsafe {
    let buf = &mut *buf;
    if len == 0 {
      if !buf.data.is_null() {
        parcel_free_buffer(buf as *mut Buffer);
        buf.data = std::ptr::null_mut();
        buf.len = 0;
        buf.cap = 0;
        buf.is_utf8 = false;
      }
      return;
    }

    let slice = std::slice::from_raw_parts(data, len);
    let vec = if !buf.data.is_null() {
      // Reuse the existing allocation.
      let mut vec = Vec::from_raw_parts(buf.data, buf.len, buf.cap);
      vec.clear();
      vec.extend_from_slice(slice);
      vec
    } else {
      slice.to_vec()
    };

    write_buffer(buf as *mut Buffer, vec, is_utf8)
  }
}

// ── Content ───────────────────────────────────────────────────────────────────

/// Returns the asset content into `*buf`. Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_content(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Ok(content) = asset.content.read() else {
    return;
  };
  unsafe { write_buffer(buf, content, false) };
}

/// Returns the asset content as a UTF-8 string into `*buf`. Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_content_utf8(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Ok(content) = asset.content.read_string() else {
    return;
  };
  unsafe { write_buffer(buf, content.into_owned().into_bytes(), true) };
}

/// Replaces the asset content with the given bytes.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_content(asset: Asset, data: *const u8, len: u32) {
  if data.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let vec = unsafe { std::slice::from_raw_parts(data, len as usize).to_vec() };
  asset.content = Arc::new(BufferContent::new(vec));
}

/// Replaces the asset content with the given UTF-8 bytes.
/// It is the caller's responsibility to validate that the data is valid UTF-8.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_content_utf8(asset: Asset, data: *const u8, len: u32) {
  if data.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let string =
    unsafe { String::from_utf8_unchecked(std::slice::from_raw_parts(data, len as usize).to_vec()) };
  asset.content = Arc::new(BufferContent::new_string(string));
}

#[derive(Debug)]
struct CContent {
  ty: [u8; 16],
  ptr: *mut c_void,
  read: extern "C" fn(content: *const c_void, buf: *mut Buffer, diagnostic: *mut Diagnostic),
  package: Option<
    extern "C" fn(
      content: *const c_void,
      bundle_graph: BundleGraph,
      bundle: Bundle,
      options: Options,
      buf: *mut Buffer,
      diagnostic: *mut Diagnostic,
    ),
  >,
  free: extern "C" fn(content: *mut c_void),
}

unsafe impl Send for CContent {}
unsafe impl Sync for CContent {}

impl Drop for CContent {
  fn drop(&mut self) {
    (self.free)(self.ptr);
  }
}

impl Content for CContent {
  fn ty(&self) -> ContentType {
    ContentType::Custom(self.ty.clone())
  }

  fn read(&self) -> Result<Vec<u8>, CoreDiagnostic> {
    let mut buf = Buffer::default();
    let mut diagnostic = Diagnostic::default();

    (self.read)(self.ptr, &mut buf, &mut diagnostic);

    let buf = if !buf.data.is_null() {
      unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) }
    } else {
      Vec::new()
    };

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
      return Err(diag);
    }

    Ok(buf)
  }

  fn read_string(&self) -> Result<Cow<'_, str>, CoreDiagnostic> {
    let mut buf = Buffer::default();
    let mut diagnostic = Diagnostic::default();

    (self.read)(self.ptr, &mut buf, &mut diagnostic);

    let bytes = if !buf.data.is_null() {
      unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) }
    } else {
      Vec::new()
    };

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
      return Err(diag);
    }

    if buf.is_utf8 {
      Ok(Cow::Owned(unsafe { String::from_utf8_unchecked(bytes) }))
    } else {
      Ok(Cow::Owned(String::from_utf8(bytes)?))
    }
  }

  fn package(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    if let Some(package) = self.package {
      let mut buf = Buffer::default();
      let mut diagnostic = Diagnostic::default();

      (package)(
        self.ptr,
        bundle_graph as *const parcel_core::BundleGraph as BundleGraph,
        bundle as *const parcel_core::Bundle as Bundle,
        options as *const ParcelOptions as Options,
        &mut buf,
        &mut diagnostic,
      );

      let bytes = if !buf.data.is_null() {
        unsafe { Vec::from_raw_parts(buf.data, buf.len, buf.cap) }
      } else {
        Vec::new()
      };

      if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
        return Err(DiagnosticList(vec![diag]));
      }

      let content = if buf.is_utf8 {
        Arc::new(BufferContent::new_string(unsafe {
          String::from_utf8_unchecked(bytes)
        }))
      } else {
        Arc::new(BufferContent::new(bytes))
      };
      Ok(content)
    } else {
      Content::package(
        self,
        bundle_graph,
        bundle,
        get_inline_bundle_content,
        options,
      )
    }
  }
}

/// Replaces the asset content with a custom content type.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_custom_content(
  asset: Asset,
  ty: *const [u8; 16],
  content: *mut c_void,
  // Callback to read the content to a buffer. Bytes should be written into the buffer using parcel_buffer_write.
  read: Option<
    extern "C" fn(content: *const c_void, buf: *mut Buffer, diagnostic: *mut Diagnostic),
  >,
  package: Option<
    extern "C" fn(
      content: *const c_void,
      bundle_graph: BundleGraph,
      bundle: Bundle,
      options: Options,
      buf: *mut Buffer,
      diagnostic: *mut Diagnostic,
    ),
  >,
  free: Option<extern "C" fn(content: *mut c_void)>,
) {
  let content = CContent {
    ty: unsafe { *ty },
    ptr: content,
    read: read.expect("a read callback must be provided to parcel_asset_set_content"),
    package,
    free: free.expect("a free callback must be provided to parcel_asset_set_content"),
  };

  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.content = Arc::new(content);
}

/// Gets the custom content and type identifier for `asset`. Returns true if the output parameters were set.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_custom_content(
  ty: *mut [u8; 16],
  content: *mut *mut c_void,
  asset: Asset,
) -> bool {
  if content.is_null() || ty.is_null() {
    return false;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  if let Some(value) = asset.content.downcast_ref::<CContent>() {
    unsafe {
      *ty = value.ty;
      *content = value.ptr
    };
    true
  } else {
    false
  }
}

// ── Bundle graph (read-only) ─────────────────────────────────────────────────

/// Returns the number of assets in the graph.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_graph_get_asset_count(bundle_graph: BundleGraph) -> usize {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph.asset_graph.assets.len()
}

/// Returns a borrowed, read-only asset handle, or zero when `index` is out of bounds.
/// The handle is valid only for the lifetime of the bundle graph and must only be
/// passed to `parcel_asset_get_*` functions.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_graph_get_asset(
  bundle_graph: BundleGraph,
  index: AssetIndex,
) -> Asset {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph
    .asset_graph
    .assets
    .get(index as usize)
    .map_or(0, |asset| asset as *const CoreAsset as Asset)
}

/// Returns the number of bundles in the graph.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_graph_get_bundle_count(bundle_graph: BundleGraph) -> usize {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph.bundles.len()
}

/// Returns a borrowed bundle handle, or zero when `index` is out of bounds.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_graph_get_bundle(
  bundle_graph: BundleGraph,
  index: BundleIndex,
) -> Bundle {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph
    .bundles
    .get(index)
    .map_or(0, |bundle| bundle as *const parcel_core::Bundle as Bundle)
}

/// Returns the resolution of one dependency belonging to an asset.
/// Returns `PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID` for invalid indices.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_graph_get_dependency_resolution(
  bundle_graph: BundleGraph,
  asset: AssetIndex,
  dependency_index: usize,
) -> BundleGraphDependencyResolution {
  if bundle_graph == 0 {
    return BundleGraphDependencyResolution::default();
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  let Some(asset_value) = bundle_graph.asset_graph.assets.get(asset as usize) else {
    return BundleGraphDependencyResolution::default();
  };
  if dependency_index >= asset_value.dependencies.len() {
    return BundleGraphDependencyResolution::default();
  }

  let mut result = BundleGraphDependencyResolution::default();
  match bundle_graph.dependency_resolution(CoreAssetIndex(asset), dependency_index) {
    CoreBundleGraphDependencyResolution::None => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE;
    }
    CoreBundleGraphDependencyResolution::Deferred => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED;
    }
    CoreBundleGraphDependencyResolution::External => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL;
    }
    CoreBundleGraphDependencyResolution::Excluded => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED;
    }
    CoreBundleGraphDependencyResolution::Asset(asset) => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET;
      result.asset = asset.0;
    }
    CoreBundleGraphDependencyResolution::Bundle(bundle) => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE;
      result.bundle = bundle as usize;
    }
  }
  result
}

// ── Bundle (read-only) ───────────────────────────────────────────────────────

/// Returns the bundle type extension (for example, `"js"`) into `*buf`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_type(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  unsafe { write_buffer(buf, bundle.ty.extension().as_bytes().to_vec(), true) };
}

/// Returns the bundle target as a borrowed handle.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_target(bundle: Bundle) -> Target {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  Arc::as_ptr(&bundle.target) as Target
}

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_bundle_behavior(bundle: Bundle) -> BundleBehavior {
  if bundle == 0 {
    return BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  match bundle.bundle_behavior {
    CoreBundleBehavior::None => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    CoreBundleBehavior::Inline => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    CoreBundleBehavior::Isolated => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
  }
}

/// Returns the raw `BundleFlags` bitfield (`PARCEL_BUNDLE_FLAG_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_flags(bundle: Bundle) -> BundleFlagsFFI {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle.flags.bits()
}

/// Returns the absolute output path into `*buf`, or leaves it empty when unnamed.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_dist_path(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  let Some(path) = bundle.dist_path else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_asset_count(bundle: Bundle) -> usize {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle.assets.len()
}

/// Returns an asset index, or `PARCEL_INVALID_ASSET_INDEX` when out of bounds.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_asset(bundle: Bundle, index: usize) -> AssetIndex {
  if bundle == 0 {
    return PARCEL_INVALID_ASSET_INDEX;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle
    .assets
    .get(index)
    .map_or(PARCEL_INVALID_ASSET_INDEX, |asset| asset.0)
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_entry_asset_count(bundle: Bundle) -> usize {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle.entry_assets.len()
}

/// Returns an entry asset index, or `PARCEL_INVALID_ASSET_INDEX` when out of bounds.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_entry_asset(bundle: Bundle, index: usize) -> AssetIndex {
  if bundle == 0 {
    return PARCEL_INVALID_ASSET_INDEX;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle
    .entry_assets
    .get(index)
    .map_or(PARCEL_INVALID_ASSET_INDEX, |asset| asset.0)
}

/// Returns the main entry asset, or `PARCEL_INVALID_ASSET_INDEX` when absent.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_main_entry_asset(bundle: Bundle) -> AssetIndex {
  if bundle == 0 {
    return PARCEL_INVALID_ASSET_INDEX;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle
    .main_entry_asset
    .map_or(PARCEL_INVALID_ASSET_INDEX, |asset| asset.0)
}

/// Returns the dist-relative bundle name into `*buf`, or leaves it empty when unnamed.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_name(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  if bundle.dist_path.is_some() {
    unsafe { write_buffer(buf, bundle.name().into_bytes(), true) };
  }
}

/// Returns the public bundle URL into `*buf`, or leaves it empty when unnamed.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_absolute_url(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  if bundle.dist_path.is_some() {
    unsafe { write_buffer(buf, bundle.absolute_url().into_bytes(), true) };
  }
}

/// Returns `bundle`'s URL relative to `from`, or leaves `*buf` empty when unavailable.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_relative_url(buf: *mut Buffer, bundle: Bundle, from: Bundle) {
  if buf.is_null() || bundle == 0 || from == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  let from: &parcel_core::Bundle = unsafe { &*(from as *const parcel_core::Bundle) };
  if let Some(url) = bundle.relative_url(from) {
    unsafe { write_buffer(buf, url.into_bytes(), true) };
  }
}

/// Returns `bundle`'s module specifier relative to `from`, or leaves `*buf` empty when unavailable.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_relative_specifier(
  buf: *mut Buffer,
  bundle: Bundle,
  from: Bundle,
) {
  if buf.is_null() || bundle == 0 || from == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  let from: &parcel_core::Bundle = unsafe { &*(from as *const parcel_core::Bundle) };
  if let Some(specifier) = bundle.relative_specifier(from) {
    unsafe { write_buffer(buf, specifier.into_bytes(), true) };
  }
}

// ── Type ──────────────────────────────────────────────────────────────────────

/// Returns the asset type extension (e.g. `"js"`, `"css"`) into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_type(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  unsafe { write_buffer(buf, asset.ty.extension().as_bytes().to_vec(), true) };
}

/// Changes the asset type to the given file-extension bytes (e.g. `"js"`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_type(asset: Asset, ty: *const u8, ty_len: usize) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let ext = unsafe { bytes_to_str(ty, ty_len) };
  asset.ty = AssetType::from_extension(ext);
}

// ── File path (read-only) ─────────────────────────────────────────────────────

/// Returns the absolute filesystem path of the source asset into `*buf`.
/// `options` is the handle received from `parcel_plugin_transform()`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_file_path(buf: *mut Buffer, asset: Asset, _options: Options) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Ok(path) = asset.loc.url.to_file_path() else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/// Returns the named pipeline into `*buf`, or leaves `buf->data == NULL` if none is set.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_pipeline(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Some(pipeline) = &asset.pipeline else {
    return;
  };
  unsafe { write_buffer(buf, pipeline.as_bytes().to_vec(), true) };
}

/// Sets the named pipeline. Pass `NULL` / `0` to clear.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_pipeline(
  asset: Asset,
  pipeline: *const u8,
  pipeline_len: usize,
) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  if pipeline.is_null() {
    asset.pipeline = None;
  } else {
    let s = unsafe { bytes_to_str(pipeline, pipeline_len) };
    asset.pipeline = Some(s.into());
  }
}

// ── BundleBehavior ────────────────────────────────────────────────────────────

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_bundle_behavior(asset: Asset) -> BundleBehavior {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  match asset.bundle_behavior {
    CoreBundleBehavior::None => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    CoreBundleBehavior::Inline => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    CoreBundleBehavior::Isolated => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
  }
}

/// Sets the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_bundle_behavior(asset: Asset, behavior: BundleBehavior) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.bundle_behavior = match behavior {
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE => CoreBundleBehavior::None,
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE => CoreBundleBehavior::Inline,
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED => CoreBundleBehavior::Isolated,
  };
}

// ── Flags ─────────────────────────────────────────────────────────────────────

/// Returns the raw `AssetFlags` bitfield (`PARCEL_ASSET_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_flags(asset: Asset) -> AssetFlagsFFI {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.flags.bits()
}

/// Replaces the `AssetFlags` bitfield.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_flags(asset: Asset, flags: AssetFlagsFFI) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.flags = CoreAssetFlags::from_bits_truncate(flags);
}

// ── UniqueKey ─────────────────────────────────────────────────────────────────

/// Returns the unique key into `*buf`, or leaves `buf->data == NULL` if not set.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_unique_key(buf: *mut Buffer, asset: Asset) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let Some(key) = &asset.unique_key else {
    return;
  };
  unsafe { write_buffer(buf, key.as_bytes().to_vec(), true) };
}

/// Sets the unique key. Pass `NULL` / `0` to clear.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_unique_key(asset: Asset, key: *const u8, key_len: usize) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  if key.is_null() {
    asset.unique_key = None;
  } else {
    let s = unsafe { bytes_to_str(key, key_len) };
    asset.unique_key = Some(s.to_owned());
  }
}

// ── Target (read-only) ────────────────────────────────────────────────────────

/// Returns an opaque `Target` handle. Valid for the duration of the transform call.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_target(asset: Asset) -> Target {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  Arc::as_ptr(&asset.target) as u64
}

/// Returns the target environment (`PARCEL_ENV_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_environment(target: Target) -> Environment {
  use parcel_core::Environment::*;
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  match target.environment {
    Browser => Environment::PARCEL_ENV_BROWSER,
    WebWorker => Environment::PARCEL_ENV_WEB_WORKER,
    ServiceWorker => Environment::PARCEL_ENV_SERVICE_WORKER,
    Worklet => Environment::PARCEL_ENV_WORKLET,
    Node => Environment::PARCEL_ENV_NODE,
    ElectronMain => Environment::PARCEL_ENV_ELECTRON_MAIN,
    ElectronRenderer => Environment::PARCEL_ENV_ELECTRON_RENDERER,
    ReactClient => Environment::PARCEL_ENV_REACT_CLIENT,
    ReactServer => Environment::PARCEL_ENV_REACT_SERVER,
  }
}

/// Returns the output format (`PARCEL_OUTPUT_FORMAT_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_output_format(target: Target) -> OutputFormat {
  use parcel_core::OutputFormat::*;
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  match target.output_format {
    Global => OutputFormat::PARCEL_OUTPUT_FORMAT_GLOBAL,
    Commonjs => OutputFormat::PARCEL_OUTPUT_FORMAT_COMMONJS,
    Esmodule => OutputFormat::PARCEL_OUTPUT_FORMAT_ESMODULE,
  }
}

/// Returns the source type (`PARCEL_SOURCE_TYPE_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_source_type(target: Target) -> SourceType {
  use parcel_core::SourceType::*;
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  match target.source_type {
    Module => SourceType::PARCEL_SOURCE_TYPE_MODULE,
    Script => SourceType::PARCEL_SOURCE_TYPE_SCRIPT,
  }
}

/// Returns the `EnvironmentFlags` bitfield (`PARCEL_ENV_FLAG_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_env_flags(target: Target) -> EnvironmentFlagsFFI {
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  target.flags.bits()
}

/// Returns the public URL (e.g. `"/"`) into `*buf`. Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_public_url(buf: *mut Buffer, target: Target) {
  if buf.is_null() {
    return;
  }
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  unsafe { write_buffer(buf, target.public_url.as_bytes().to_vec(), true) };
}

/// Returns the absolute path of the dist directory into `*buf`.
/// `options` is the handle received from `parcel_plugin_transform()`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_dist_dir(buf: *mut Buffer, target: Target, _options: Options) {
  if buf.is_null() {
    return;
  }
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  unsafe {
    write_buffer(
      buf,
      target
        .dist_dir
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

// ── Dependencies ──────────────────────────────────────────────────────────────

/// Returns the number of dependencies belonging to an asset.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_dependency_count(asset: Asset) -> usize {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.len()
}

/// Returns a borrowed, read-only dependency handle, or zero when `index` is out of bounds.
/// The handle is valid only for the lifetime of the asset.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_dependency(asset: Asset, index: usize) -> Dependency {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.get(index).map_or(0, |dependency| {
    dependency as *const CoreDependency as Dependency
  })
}

/// Appends a dependency to the asset. The new dependency inherits the asset's target.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_add_dependency(asset: Asset, dep: *const DependencyOptions) {
  if dep.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let dep = unsafe { &*dep };

  if dep.specifier.is_null() {
    return;
  }
  let specifier = unsafe { bytes_to_str(dep.specifier, dep.specifier_len) }.to_owned();

  let specifier_type = match dep.specifier_type {
    SpecifierType::PARCEL_SPECIFIER_ESM => CoreSpecifierType::Esm,
    SpecifierType::PARCEL_SPECIFIER_COMMONJS => CoreSpecifierType::Commonjs,
    SpecifierType::PARCEL_SPECIFIER_URL => CoreSpecifierType::Url,
    SpecifierType::PARCEL_SPECIFIER_CUSTOM => CoreSpecifierType::Custom,
  };
  let priority = match dep.priority {
    Priority::PARCEL_PRIORITY_SYNC => CorePriority::Sync,
    Priority::PARCEL_PRIORITY_PARALLEL => CorePriority::Parallel,
    Priority::PARCEL_PRIORITY_LAZY => CorePriority::Lazy,
  };
  let bundle_behavior = match dep.bundle_behavior {
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE => CoreBundleBehavior::None,
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE => CoreBundleBehavior::Inline,
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED => CoreBundleBehavior::Isolated,
  };
  let flags = CoreDependencyFlags::from_bits_truncate(dep.flags);

  asset.dependencies.push(CoreDependency {
    specifier,
    specifier_type,
    priority,
    bundle_behavior,
    flags,
    target: asset.target.clone(),
    loc: None,
    placeholder: None,
    resolve_from: Some(asset.loc.url.clone()),
    range: None,
    conditions: CoreExportsCondition::from_bits_truncate(dep.conditions),
    resolution: DependencyResolution::None,
  });
}

// ── Symbols ───────────────────────────────────────────────────────────────────

/// Registers an exported symbol name (e.g. `"default"`, `"foo"`, `"*"`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_add_export_symbol(asset: Asset, name: *const u8, name_len: usize) {
  if name.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let name = unsafe { bytes_to_str(name, name_len) };
  asset.symbols.exports.push(LocalSymbol {
    exported: SymbolName::from(name),
    requested: false,
  });
}

// ── Dependency accessors (read-only) ──────────────────────────────────────────

/// Returns the raw specifier string (e.g. `"custom:greeting"`) into `*buf`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_specifier(buf: *mut Buffer, dep: Dependency) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  unsafe { write_buffer(buf, dep.specifier.as_bytes().to_vec(), true) };
}

/// Returns the specifier type (`PARCEL_SPECIFIER_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_specifier_type(dep: Dependency) -> SpecifierType {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  match dep.specifier_type {
    CoreSpecifierType::Esm => SpecifierType::PARCEL_SPECIFIER_ESM,
    CoreSpecifierType::Commonjs => SpecifierType::PARCEL_SPECIFIER_COMMONJS,
    CoreSpecifierType::Url => SpecifierType::PARCEL_SPECIFIER_URL,
    CoreSpecifierType::Custom => SpecifierType::PARCEL_SPECIFIER_CUSTOM,
  }
}

/// Returns the priority (`PARCEL_PRIORITY_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_priority(dep: Dependency) -> Priority {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  match dep.priority {
    CorePriority::Sync => Priority::PARCEL_PRIORITY_SYNC,
    CorePriority::Parallel => Priority::PARCEL_PRIORITY_PARALLEL,
    CorePriority::Lazy => Priority::PARCEL_PRIORITY_LAZY,
  }
}

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_bundle_behavior(dep: Dependency) -> BundleBehavior {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  match dep.bundle_behavior {
    CoreBundleBehavior::None => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    CoreBundleBehavior::Inline => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    CoreBundleBehavior::Isolated => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
  }
}

/// Returns the raw `DependencyFlags` bitfield (`PARCEL_DEP_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_flags(dep: Dependency) -> DependencyFlagsFFI {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.flags.bits()
}

/// Returns the raw `ExportsConditions` bitfield (`PARCEL_EXPORTS_CONDITION_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_conditions(dep: Dependency) -> ExportsConditionsFFI {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.conditions.bits()
}

/// Returns the absolute path of the file containing this import into `*buf`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_source_path(buf: *mut Buffer, dep: Dependency, _options: Options) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  let Some(loc) = &dep.loc else { return };
  let Ok(path) = loc.url.to_file_path() else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

/// Returns the base path for resolving the specifier into `*buf`.
/// Falls back to the source file path when `resolve_from` is not set.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_resolve_from(
  buf: *mut Buffer,
  dep: Dependency,
  _options: Options,
) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  let url = dep
    .resolve_from
    .as_ref()
    .or_else(|| dep.loc.as_ref().map(|loc| &loc.url));
  let Some(url) = url else { return };
  let Ok(path) = url.to_file_path() else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

/// Returns an opaque `Target` handle for the dependency.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_target(dep: Dependency) -> Target {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  Arc::as_ptr(&dep.target) as u64
}

// ── Options accessors (read-only) ─────────────────────────────────────────────

/// Returns the project root as an absolute filesystem path into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_options_get_project_root(buf: *mut Buffer, options: Options) {
  if buf.is_null() {
    return;
  }
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  unsafe {
    write_buffer(
      buf,
      options
        .project_root
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

/// Looks up `key` in the build environment map.
/// Writes the value into `*buf` if found; leaves `buf->data == NULL` if not.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_options_get_env(
  buf: *mut Buffer,
  options: Options,
  key: *const u8,
  key_len: usize,
) {
  if buf.is_null() || key.is_null() {
    return;
  }
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let key_str = unsafe { bytes_to_str(key, key_len) };
  if let Some(value) = options.env.get(key_str) {
    unsafe { write_buffer(buf, value.as_bytes().to_vec(), true) };
  }
}

// ── Internal diagnostic helpers ───────────────────────────────────────────────

fn read_cdiagnostic(
  diag: &mut Diagnostic,
  project_root: Option<&PathId>,
) -> Option<CoreDiagnostic> {
  if diag.message.data.is_null() {
    return None;
  }

  let read_buf = |buf: &mut Buffer| -> String {
    let s = unsafe {
      std::str::from_utf8(std::slice::from_raw_parts(buf.data, buf.len))
        .unwrap_or("")
        .to_owned()
    };
    parcel_free_buffer(buf);
    s
  };

  let message = read_buf(&mut diag.message);
  let severity = match diag.severity {
    DiagnosticSeverity::PARCEL_SEVERITY_ERROR => CoreDiagnosticSeverity::Error,
    DiagnosticSeverity::PARCEL_SEVERITY_WARNING => CoreDiagnosticSeverity::Warning,
    DiagnosticSeverity::PARCEL_SEVERITY_SOURCE_ERROR => CoreDiagnosticSeverity::SourceError,
    DiagnosticSeverity::PARCEL_SEVERITY_INFO => CoreDiagnosticSeverity::Info,
  };

  let code_frames = if !diag.file_path.data.is_null() {
    let path_str = read_buf(&mut diag.file_path);
    if project_root.is_some() {
      let url = Some(SourceUrl::from_path(&PathId::new(Path::new(&path_str))));
      let code_highlights = if diag.line > 0 {
        vec![CodeHighlight {
          start: Location {
            line: diag.line,
            column: diag.column.max(1),
          },
          end: Location {
            line: diag.line,
            column: diag.column.max(1),
          },
          message: None,
        }]
      } else {
        vec![]
      };
      vec![CodeFrame {
        url,
        code_highlights,
        ..Default::default()
      }]
    } else {
      vec![]
    }
  } else {
    vec![]
  };

  let hints = if !diag.hint.data.is_null() {
    vec![read_buf(&mut diag.hint)]
  } else {
    vec![]
  };

  Some(CoreDiagnostic {
    message,
    severity,
    code_frames,
    hints,
    origin: None,
    documentation_url: None,
  })
}

// ── CPlugin ───────────────────────────────────────────────────────────────────

pub struct CPlugin {
  // ManuallyDrop prevents dlclose() from being called on drop. Go shared
  // libraries cannot be unloaded: their runtime starts background goroutines
  // that block dlclose() indefinitely. The OS reclaims all resources on
  // process exit without needing an explicit unload.
  lib: ManuallyDrop<Library>,
  state: *mut c_void,
}

unsafe impl Send for CPlugin {}
unsafe impl Sync for CPlugin {}

impl CPlugin {
  pub fn new(path: PathId, config: Option<&serde_json::Value>) -> Result<CPlugin, DiagnosticList> {
    let lib = path
      .with_path(|path| unsafe { Library::new(path) })
      .map_err(|e| DiagnosticList(vec![CoreDiagnostic::from_message(e.to_string())]))?;
    let state = Self::call_init(&lib, config)?;
    Ok(CPlugin {
      lib: ManuallyDrop::new(lib),
      state,
    })
  }

  fn call_init(
    lib: &Library,
    config: Option<&serde_json::Value>,
  ) -> Result<*mut c_void, DiagnosticList> {
    type InitFn = extern "C" fn(*const u8, usize, *mut Diagnostic) -> *mut c_void;
    let sym: Result<Symbol<InitFn>, _> = unsafe { lib.get(b"parcel_plugin_init") };
    let Ok(init_fn) = sym else {
      return Ok(ptr::null_mut());
    };

    let config_bytes = config
      .and_then(|v| serde_json::to_vec(v).ok())
      .unwrap_or_default();

    let mut diagnostic = Diagnostic::default();
    let state = init_fn(config_bytes.as_ptr(), config_bytes.len(), &mut diagnostic);

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, None) {
      return Err(DiagnosticList(vec![diag]));
    }
    Ok(state)
  }
}

impl Drop for CPlugin {
  fn drop(&mut self) {
    if self.state.is_null() {
      return;
    }
    type DeinitFn = extern "C" fn(*mut c_void);
    let sym: Result<Symbol<DeinitFn>, _> = unsafe { self.lib.get(b"parcel_plugin_deinit") };
    if let Ok(deinit_fn) = sym {
      deinit_fn(self.state);
    }
  }
}

impl Transformer for CPlugin {
  fn transform(
    &self,
    mut asset: CoreAsset,
    options: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<CoreAsset, DiagnosticList> {
    type TransformFn = extern "C" fn(Asset, Options, *mut c_void, *mut Diagnostic);
    let transform: Symbol<TransformFn> = unsafe {
      self
        .lib
        .get(b"parcel_plugin_transform")
        .expect("Failed to find parcel_plugin_transform symbol")
    };

    let mut diagnostic = Diagnostic::default();
    transform(
      &mut asset as *mut CoreAsset as Asset,
      options as *const ParcelOptions as Options,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      return Err(DiagnosticList(vec![diag]));
    }
    Ok(asset)
  }
}

impl Resolver for CPlugin {
  fn resolve(
    &self,
    dep: &CoreDependency,
    specifier: &str,
    pipeline: Option<&str>,
    options: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<DependencyResolution, DiagnosticList> {
    type ResolveFn = extern "C" fn(
      Dependency,
      *const u8,
      usize, // specifier
      *const u8,
      usize, // pipeline (null ptr = no pipeline)
      Options,
      *mut ResolveResult,
      *mut c_void,
      *mut Diagnostic,
    );
    let resolve: Symbol<ResolveFn> = unsafe {
      self
        .lib
        .get(b"parcel_plugin_resolve")
        .expect("Failed to find parcel_plugin_resolve symbol")
    };

    let mut result = ResolveResult {
      resolution_type: ResolutionType::PARCEL_RESOLUTION_NONE,
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      pipeline: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
    };
    let mut diagnostic = Diagnostic {
      message: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      line: 0,
      column: 0,
      hint: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
        is_utf8: false,
      },
      severity: DiagnosticSeverity::PARCEL_SEVERITY_ERROR,
    };

    let pipeline_bytes = pipeline.map(|p| p.as_bytes());

    resolve(
      dep as *const CoreDependency as Dependency,
      specifier.as_ptr(),
      specifier.len(),
      pipeline_bytes.map_or(ptr::null(), |b| b.as_ptr()),
      pipeline_bytes.map_or(0, |b| b.len()),
      options as *const ParcelOptions as Options,
      &mut result,
      self.state,
      &mut diagnostic,
    );

    if let Some(diag) = read_cdiagnostic(&mut diagnostic, Some(&options.project_root)) {
      return Err(DiagnosticList(vec![diag]));
    }

    match result.resolution_type {
      ResolutionType::PARCEL_RESOLUTION_FILE_PATH => {
        if result.file_path.data.is_null() {
          return Ok(DependencyResolution::None);
        }
        let file_path = {
          let file_path_str = unsafe {
            std::ffi::OsStr::from_encoded_bytes_unchecked(std::slice::from_raw_parts(
              result.file_path.data,
              result.file_path.len,
            ))
          };
          let path = Path::new(file_path_str).to_path_buf();
          parcel_free_buffer(&mut result.file_path);
          path
        };

        let result_pipeline = if result.pipeline.data.is_null() {
          None
        } else {
          let s = unsafe {
            std::str::from_utf8(std::slice::from_raw_parts(
              result.pipeline.data,
              result.pipeline.len,
            ))
            .unwrap_or("")
          };
          let atom = Some(hstr::Atom::from(s));
          parcel_free_buffer(&mut result.pipeline);
          atom
        };

        let url = SourceUrl::from_path(&PathId::new(&file_path));
        let ty =
          AssetType::from_extension(file_path.extension().and_then(|e| e.to_str()).unwrap_or(""));

        Ok(DependencyResolution::Deferred(Arc::new(AssetRequest {
          loc: SourceLocation {
            url,
            ..Default::default()
          },
          ty,
          pipeline: result_pipeline,
          target: dep.target.clone(),
          content: Arc::new(FileContent::new(
            PathId::new(&file_path),
            options.input_fs.clone(),
          )),
          side_effects: true,
        })))
      }
      ResolutionType::PARCEL_RESOLUTION_EXTERNAL => Ok(DependencyResolution::External),
      ResolutionType::PARCEL_RESOLUTION_EXCLUDED => Ok(DependencyResolution::Excluded),
      ResolutionType::PARCEL_RESOLUTION_NONE => Ok(DependencyResolution::None),
    }
  }
}
