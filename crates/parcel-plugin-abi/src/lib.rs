#![allow(non_camel_case_types)]

use libloading::{Library, Symbol};
use std::{
  collections::HashMap,
  ffi::c_void,
  mem::ManuallyDrop,
  path::{Path, PathBuf},
  ptr,
  sync::{Arc, Mutex, OnceLock},
};

use parcel_core::{
  Asset as CoreAsset, AssetFlags as CoreAssetFlags, AssetRequest, AssetType, BufferContent,
  BundleBehavior as CoreBundleBehavior, CodeFrame, CodeHighlight, Dependency as CoreDependency,
  DependencyFlags as CoreDependencyFlags, DependencyResolution, Diagnostic as CoreDiagnostic,
  DiagnosticList, DiagnosticSeverity as CoreDiagnosticSeverity,
  EnvironmentFlags as CoreEnvironmentFlags, ExportsCondition, FileContent, Invalidations,
  LocalSymbol, Location, ParcelOptions, Priority as CorePriority, Resolver, SourceLocation,
  SourceUrl, SpecifierType as CoreSpecifierType, SymbolName, Transformer,
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

// DiagnosticSeverity — CDiagnostic.severity field
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum DiagnosticSeverity {
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

// ── Buffer ────────────────────────────────────────────────────────────────────

unsafe fn bytes_to_str<'a>(data: *const u8, len: usize) -> &'a str {
  if data.is_null() || len == 0 {
    return "";
  }
  unsafe { std::str::from_utf8(std::slice::from_raw_parts(data, len)).unwrap_or("") }
}

/// Owned byte buffer returned by getter functions.
/// Release with `parcel_free_buffer()` when done.
/// Zero-initialise before use so a no-op getter leaves `data == NULL`.
#[repr(C)]
pub struct Buffer {
  pub data: *mut u8,
  pub len: usize,
  pub cap: usize,
}

unsafe fn write_buffer(buffer: *mut Buffer, mut bytes: Vec<u8>) {
  unsafe {
    (*buffer).data = bytes.as_mut_ptr();
    (*buffer).len = bytes.len();
    (*buffer).cap = bytes.capacity();
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
  pub flags: DependencyFlags,
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
  if data.is_null() || len == 0 {
    return Buffer {
      data: ptr::null_mut(),
      len: 0,
      cap: 0,
    };
  }
  let bytes = unsafe { std::slice::from_raw_parts(data, len) }.to_vec();
  let mut buf = Buffer {
    data: ptr::null_mut(),
    len: 0,
    cap: 0,
  };
  unsafe { write_buffer(&mut buf, bytes) };
  buf
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
  unsafe { write_buffer(buf, content) };
}

/// Replaces the asset content with the given bytes.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_content(asset: Asset, data: *const u8, len: u32) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let vec = unsafe { std::slice::from_raw_parts(data, len as usize).to_vec() };
  asset.content = Arc::new(BufferContent::new(vec));
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
  unsafe { write_buffer(buf, asset.ty.extension().as_bytes().to_vec()) };
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
pub extern "C" fn parcel_asset_get_file_path(buf: *mut Buffer, asset: Asset, options: Options) {
  if buf.is_null() {
    return;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let Ok(path) = asset.loc.url.to_file_path(&options.project_root) else {
    return;
  };
  unsafe { write_buffer(buf, path.to_string_lossy().into_owned().into_bytes()) };
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
  unsafe { write_buffer(buf, pipeline.as_bytes().to_vec()) };
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
pub extern "C" fn parcel_asset_get_flags(asset: Asset) -> AssetFlags {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  unsafe { std::mem::transmute(asset.flags.bits()) }
}

/// Replaces the `AssetFlags` bitfield.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_set_flags(asset: Asset, flags: AssetFlags) {
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  asset.flags = CoreAssetFlags::from_bits_truncate(flags as u32);
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
  unsafe { write_buffer(buf, key.as_bytes().to_vec()) };
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
pub extern "C" fn parcel_target_get_env_flags(target: Target) -> EnvironmentFlags {
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  unsafe { std::mem::transmute(target.flags.bits()) }
}

/// Returns the public URL (e.g. `"/"`) into `*buf`. Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_public_url(buf: *mut Buffer, target: Target) {
  if buf.is_null() {
    return;
  }
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  unsafe { write_buffer(buf, target.public_url.as_bytes().to_vec()) };
}

/// Returns the absolute path of the dist directory into `*buf`.
/// `options` is the handle received from `parcel_plugin_transform()`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_dist_dir(buf: *mut Buffer, target: Target, options: Options) {
  if buf.is_null() {
    return;
  }
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let Ok(path) = target.dist_dir.to_file_path(&options.project_root) else {
    return;
  };
  unsafe { write_buffer(buf, path.to_string_lossy().into_owned().into_bytes()) };
}

// ── Dependencies ──────────────────────────────────────────────────────────────

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
  let flags = CoreDependencyFlags::from_bits_truncate(dep.flags as u8);

  asset.dependencies.push(CoreDependency {
    specifier,
    specifier_type,
    priority,
    bundle_behavior,
    flags,
    target: asset.target.clone(),
    loc: None,
    placeholder: None,
    resolve_from: None,
    range: None,
    conditions: ExportsCondition::empty(),
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
  unsafe { write_buffer(buf, dep.specifier.as_bytes().to_vec()) };
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
pub extern "C" fn parcel_dep_get_flags(dep: Dependency) -> DependencyFlags {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  unsafe { std::mem::transmute(dep.flags.bits()) }
}

/// Returns the absolute path of the file containing this import into `*buf`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_source_path(buf: *mut Buffer, dep: Dependency, options: Options) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let Some(loc) = &dep.loc else { return };
  let Ok(path) = loc.url.to_file_path(&options.project_root) else {
    return;
  };
  unsafe { write_buffer(buf, path.to_string_lossy().into_owned().into_bytes()) };
}

/// Returns the base path for resolving the specifier into `*buf`.
/// Falls back to the source file path when `resolve_from` is not set.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_resolve_from(buf: *mut Buffer, dep: Dependency, options: Options) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let url = dep
    .resolve_from
    .as_ref()
    .or_else(|| dep.loc.as_ref().map(|loc| &loc.url));
  let Some(url) = url else { return };
  let Ok(path) = url.to_file_path(&options.project_root) else {
    return;
  };
  unsafe { write_buffer(buf, path.to_string_lossy().into_owned().into_bytes()) };
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
  let Ok(path) = options.project_root.to_file_path(&options.project_root) else {
    return;
  };
  unsafe { write_buffer(buf, path.to_string_lossy().into_owned().into_bytes()) };
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
    unsafe { write_buffer(buf, value.as_bytes().to_vec()) };
  }
}

// ── Internal diagnostic helpers ───────────────────────────────────────────────

fn read_cdiagnostic(
  diag: &mut Diagnostic,
  project_root: Option<&SourceUrl>,
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
    if let Some(project_root) = project_root {
      let url = SourceUrl::from_path(Path::new(&path_str), project_root).ok();
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
  pub fn new(path: &Path, config: Option<&serde_json::Value>) -> Result<CPlugin, DiagnosticList> {
    let lib = unsafe { Library::new(path) }
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

    let mut diagnostic = Diagnostic {
      message: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      line: 0,
      column: 0,
      hint: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      severity: DiagnosticSeverity::PARCEL_SEVERITY_ERROR,
    };

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
  ) -> Result<CoreAsset, DiagnosticList> {
    type TransformFn = extern "C" fn(Asset, Options, *mut c_void, *mut Diagnostic);
    let transform: Symbol<TransformFn> = unsafe {
      self
        .lib
        .get(b"parcel_plugin_transform")
        .expect("Failed to find parcel_plugin_transform symbol")
    };

    let mut diagnostic = Diagnostic {
      message: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      line: 0,
      column: 0,
      hint: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      severity: DiagnosticSeverity::PARCEL_SEVERITY_ERROR,
    };
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
    _invalidations: &mut Invalidations,
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
      },
      pipeline: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
    };
    let mut diagnostic = Diagnostic {
      message: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      file_path: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
      },
      line: 0,
      column: 0,
      hint: Buffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
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

        let url = SourceUrl::from_path(&file_path, &options.project_root)
          .map_err(|e| DiagnosticList(vec![e]))?;
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
          content: Arc::new(FileContent::new(file_path, options.input_fs.clone())),
          side_effects: true,
        })))
      }
      ResolutionType::PARCEL_RESOLUTION_EXTERNAL => Ok(DependencyResolution::External),
      ResolutionType::PARCEL_RESOLUTION_EXCLUDED => Ok(DependencyResolution::Excluded),
      ResolutionType::PARCEL_RESOLUTION_NONE => Ok(DependencyResolution::None),
    }
  }
}
