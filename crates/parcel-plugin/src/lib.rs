//! Rust SDK for building Parcel transformer and resolver plugins.
//!
//! Plugins are compiled as `cdylib` crates.  Implement the [`Plugin`] trait on
//! a struct that holds your parsed config, then call [`register_plugin!`] once
//! at the crate root:
//!
//! ```rust,ignore
//! use parcel_plugin::{Asset, Diagnostic, Plugin, register_plugin};
//!
//! struct MyPlugin;
//!
//! impl Plugin for MyPlugin {
//!     fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
//!         Ok(MyPlugin)
//!     }
//!     fn transform(&self, asset: &mut Asset, _options: &Options) -> Result<(), Diagnostic> {
//!         asset.set_content(format!("export default {:?};\n", asset.content()));
//!         asset.set_type("js");
//!         Ok(())
//!     }
//! }
//!
//! register_plugin!(MyPlugin);
//! ```
//!
//! The macro generates all four ABI symbols: `parcel_plugin_init` (calls
//! `MyPlugin::new`), `parcel_plugin_deinit` (drops the boxed value),
//! `parcel_plugin_transform`, and `parcel_plugin_resolve`.  Override only the
//! methods you need; the default implementations return an error so
//! misconfiguration is visible immediately.
//!
//! Plugin crates must configure the linker to allow Parcel's ABI symbols to be
//! resolved at load time.  Add a `build.rs` containing:
//!
//! ```rust,ignore
//! fn main() {
//!     #[cfg(target_os = "macos")]
//!     println!("cargo:rustc-link-arg=-Wl,-undefined,dynamic_lookup");
//!     #[cfg(target_os = "linux")]
//!     println!("cargo:rustc-link-arg=-Wl,--allow-shlib-undefined");
//! }
//! ```

use std::any::TypeId;
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::ptr;

pub mod ffi;

// ── Buffer ─────────────────────────────────────────────────────────────────

pub use ffi::Buffer;

impl Default for Buffer {
  fn default() -> Self {
    Buffer {
      data: ptr::null_mut(),
      len: 0,
      cap: 0,
      is_utf8: false,
    }
  }
}

impl Drop for Buffer {
  fn drop(&mut self) {
    if !self.data.is_null() {
      unsafe { ffi::parcel_free_buffer(self as *mut Buffer) };
    }
  }
}

impl Buffer {
  fn to_string(&self) -> Option<String> {
    if self.data.is_null() {
      return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(self.data as *const u8, self.len) };
    if self.is_utf8 {
      Some(unsafe { String::from_utf8_unchecked(bytes.to_vec()) })
    } else {
      String::from_utf8(bytes.to_vec()).ok()
    }
  }

  fn to_bytes(&self) -> Option<Vec<u8>> {
    if self.data.is_null() {
      return None;
    }
    Some(unsafe { std::slice::from_raw_parts(self.data as *const u8, self.len) }.to_vec())
  }
}

// ── Options ────────────────────────────────────────────────────────────────

/// Read-only view of the Parcel build options. Passed to every plugin call.
pub struct Options {
  raw: u64,
}

impl Options {
  pub unsafe fn from_raw(raw: u64) -> Self {
    Options { raw }
  }

  /// Returns the absolute project root path.
  pub fn project_root(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_options_get_project_root(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Looks up `key` in the build environment map. Returns `None` if not set.
  pub fn env(&self, key: &str) -> Option<String> {
    let mut buf = Buffer::default();
    let b = key.as_bytes();
    unsafe { ffi::parcel_options_get_env(&mut buf, self.raw, b.as_ptr(), b.len()) };
    buf.to_string()
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

/// How a dependency specifier is interpreted.
pub use ffi::SpecifierType;

impl Default for SpecifierType {
  fn default() -> Self {
    Self::Esm
  }
}

/// When a dependency is loaded relative to the importing asset.
pub use ffi::Priority;

impl Default for Priority {
  fn default() -> Self {
    Self::Sync
  }
}

/// Controls how the asset's output bundle is handled.
pub use ffi::BundleBehavior;

impl Default for BundleBehavior {
  fn default() -> Self {
    Self::None
  }
}

/// Target execution environment (read-only from a transformer).
pub use ffi::Environment;

/// Output module format (read-only from a transformer).
pub use ffi::OutputFormat;

/// Whether the target expects ES module or classic script source.
pub use ffi::SourceType;

/// Bitfield of target environment flags (read-only from a transformer).
pub use ffi::EnvironmentFlags;

impl EnvironmentFlags {
  pub fn contains(self, other: EnvironmentFlags) -> bool {
    self.0 & other.0 == other.0
  }
}

/// Bitfield of asset state flags.
pub use ffi::AssetFlags;

impl AssetFlags {
  pub fn contains(self, other: AssetFlags) -> bool {
    self.0 & other.0 == other.0
  }
}

/// Bitfield describing bundle state.
pub use ffi::BundleFlags;

impl BundleFlags {
  pub fn contains(self, other: BundleFlags) -> bool {
    self.0 & other.0 == other.0
  }
}

pub type AssetIndex = ffi::AssetIndex;
pub type BundleIndex = ffi::BundleIndex;

/// Bitfield of dependency flags.
pub use ffi::DependencyFlags;

impl DependencyFlags {
  pub fn contains(self, other: DependencyFlags) -> bool {
    self.0 & other.0 == other.0
  }
}

impl Default for DependencyFlags {
  fn default() -> Self {
    DependencyFlags(0)
  }
}

/// A dependency to be added to an asset from a transformer.
#[derive(Default, Debug)]
pub struct DependencyOptions {
  /// Module specifier (e.g. `"./foo.js"` or `"react"`).
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
}

impl DependencyOptions {
  /// Creates an ESM sync dependency with default flags.
  pub fn new(specifier: impl Into<String>) -> Self {
    DependencyOptions {
      specifier: specifier.into(),
      ..Default::default()
    }
  }
}

// ── Diagnostic ─────────────────────────────────────────────────────────────

/// How a diagnostic is treated by Parcel.
pub use ffi::DiagnosticSeverity;

impl Default for DiagnosticSeverity {
  fn default() -> Self {
    Self::Error
  }
}

/// A structured error or warning returned by a plugin.
///
/// Implements [`std::error::Error`] so it can be used with `?` and `Box<dyn Error>`.
/// Also implements `From<String>` and `From<&str>` for quick error creation.
///
/// Use the builder methods to attach optional context:
/// ```rust,ignore
/// return Err(Diagnostic::new("bad input")
///     .with_file(asset.file_path())
///     .at(10, 5)
///     .with_hint("check the syntax"));
/// ```
#[derive(Default, Debug)]
pub struct Diagnostic {
  pub message: String,
  pub severity: DiagnosticSeverity,
  /// Absolute file path for a source code frame (optional).
  pub file_path: Option<String>,
  /// 1-based start line for the code highlight (0 = not set).
  pub line: u32,
  /// 1-based start column (0 = not set).
  pub column: u32,
  /// A single hint string (optional).
  pub hint: Option<String>,
}

impl Diagnostic {
  pub fn new(message: impl Into<String>) -> Self {
    Diagnostic {
      message: message.into(),
      ..Default::default()
    }
  }

  pub fn warning(message: impl Into<String>) -> Self {
    Diagnostic {
      message: message.into(),
      severity: DiagnosticSeverity::Warning,
      ..Default::default()
    }
  }

  /// Attaches a source file path for a code frame.
  pub fn with_file(mut self, file_path: impl Into<String>) -> Self {
    self.file_path = Some(file_path.into());
    self
  }

  /// Sets the 1-based line and column for a code highlight.
  pub fn at(mut self, line: u32, column: u32) -> Self {
    self.line = line;
    self.column = column;
    self
  }

  /// Attaches a hint string.
  pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
    self.hint = Some(hint.into());
    self
  }

  /// Writes this diagnostic into a host-allocated [`ffi::Diagnostic`].
  /// Intended for use inside macro-generated entry points only.
  pub fn write_to_raw(&self, raw: *mut ffi::Diagnostic) {
    if raw.is_null() {
      return;
    }
    unsafe {
      (*raw).message = ffi::parcel_buffer_alloc(self.message.as_ptr(), self.message.len());
      (*raw).severity = self.severity;
      if let Some(fp) = &self.file_path {
        (*raw).file_path = ffi::parcel_buffer_alloc(fp.as_ptr(), fp.len());
      }
      (*raw).line = self.line;
      (*raw).column = self.column;
      if let Some(hint) = &self.hint {
        (*raw).hint = ffi::parcel_buffer_alloc(hint.as_ptr(), hint.len());
      }
    }
  }
}

impl std::fmt::Display for Diagnostic {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.message)
  }
}

impl std::error::Error for Diagnostic {}

impl From<String> for Diagnostic {
  fn from(message: String) -> Self {
    Diagnostic::new(message)
  }
}

impl From<&str> for Diagnostic {
  fn from(message: &str) -> Self {
    Diagnostic::new(message)
  }
}

// ── Asset ──────────────────────────────────────────────────────────────────

/// A handle to the asset being transformed.
///
/// Every method forwards to the corresponding `parcel_asset_*` ABI function.
/// The handle is valid only for the duration of the transformer call.
pub struct Asset {
  raw: u64,
  options: u64,
}

impl Asset {
  /// Wraps the raw Parcel asset handle. Called by [`register_plugin!`].
  ///
  /// # Safety
  ///
  /// `raw` must be the opaque asset pointer supplied by Parcel, and
  /// `options` must be the opaque options handle supplied alongside it.
  pub unsafe fn from_raw(raw: u64, options: u64) -> Self {
    Asset { raw, options }
  }

  // ── Content ──────────────────────────────────────────────────────────────

  /// Returns the asset source content as a UTF-8 string.
  pub fn content(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_content(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the asset source content as raw bytes.
  pub fn content_bytes(&self) -> Vec<u8> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_content(&mut buf, self.raw) };
    buf.to_bytes().unwrap_or_default()
  }

  /// Replaces the asset content with a UTF-8 string.
  pub fn set_content(&mut self, content: impl AsRef<str>) {
    let bytes = content.as_ref().as_bytes();
    unsafe { ffi::parcel_asset_set_content_utf8(self.raw, bytes.as_ptr(), bytes.len() as u32) };
  }

  /// Replaces the asset content with raw bytes.
  pub fn set_content_bytes(&mut self, bytes: &[u8]) {
    unsafe { ffi::parcel_asset_set_content(self.raw, bytes.as_ptr(), bytes.len() as u32) };
  }

  pub fn set_custom_content<T: AssetContent>(&mut self, content: T) {
    unsafe extern "C" fn read_content<T: AssetContent>(
      content: *const c_void,
      buf: *mut Buffer,
      diagnostic: *mut ffi::Diagnostic,
    ) {
      let content = unsafe { &*(content as *const T) as &T };
      match content.read() {
        Ok(ContentBuffer::Bytes(b)) => {
          unsafe { ffi::parcel_buffer_write(buf, b.as_ptr(), b.len()) };
        }
        Ok(ContentBuffer::String(s)) => {
          unsafe { ffi::parcel_buffer_write_utf8(buf, s.as_bytes().as_ptr(), s.len()) };
        }
        Err(e) => {
          e.write_to_raw(diagnostic);
        }
      }
    }

    unsafe extern "C" fn package_content<T: AssetContent>(
      content: *const c_void,
      bundle_graph: ffi::BundleGraph,
      bundle: ffi::Bundle,
      options: ffi::Options,
      buf: *mut Buffer,
      diagnostic: *mut ffi::Diagnostic,
    ) {
      let content = unsafe { &*(content as *const T) as &T };
      let bundle_graph = unsafe { BundleGraph::from_raw(bundle_graph, options) };
      let bundle = unsafe { Bundle::from_raw(bundle, options) };
      let options = unsafe { Options::from_raw(options) };
      match content.package(&bundle_graph, &bundle, &options) {
        Ok(ContentBuffer::Bytes(b)) => {
          unsafe { ffi::parcel_buffer_write(buf, b.as_ptr(), b.len()) };
        }
        Ok(ContentBuffer::String(s)) => {
          unsafe { ffi::parcel_buffer_write_utf8(buf, s.as_bytes().as_ptr(), s.len()) };
        }
        Err(e) => {
          e.write_to_raw(diagnostic);
        }
      }
    }

    unsafe extern "C" fn free_content<T: AssetContent>(content: *mut c_void) {
      drop(unsafe { Box::from_raw(content as *mut T) })
    }

    let ty = type_id::<T>();
    unsafe {
      ffi::parcel_asset_set_custom_content(
        self.raw,
        &ty,
        Box::leak(Box::new(content)) as *mut T as *mut c_void,
        Some(read_content::<T>),
        Some(package_content::<T>),
        Some(free_content::<T>),
      );
    }
  }

  pub fn custom_content<T: AssetContent>(&self) -> Option<&T> {
    let mut ty = [0; 16];
    let mut content = std::ptr::null_mut();
    unsafe {
      if !ffi::parcel_asset_get_custom_content(&mut ty, &mut content, self.raw) {
        return None;
      }
      if !content.is_null() {
        let expected_ty = type_id::<T>();
        if ty != expected_ty {
          return None;
        }
        return Some(&*(content as *const T));
      }
    }

    None
  }

  // ── Type ─────────────────────────────────────────────────────────────────

  /// Returns the asset type extension (e.g. `"js"`, `"css"`).
  pub fn asset_type(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_type(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Changes the asset type to the given file extension.
  pub fn set_type(&mut self, ty: &str) {
    let b = ty.as_bytes();
    unsafe { ffi::parcel_asset_set_type(self.raw, b.as_ptr(), b.len()) };
  }

  // ── File path (read-only) ─────────────────────────────────────────────────

  /// Returns the absolute filesystem path of the source asset.
  pub fn file_path(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_file_path(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  // ── Pipeline ─────────────────────────────────────────────────────────────

  /// Returns the named pipeline, or `None` if not set.
  pub fn pipeline(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_pipeline(&mut buf, self.raw) };
    buf.to_string()
  }

  /// Sets the named pipeline.  Pass `None` to clear.
  pub fn set_pipeline(&mut self, pipeline: Option<&str>) {
    match pipeline {
      None => unsafe { ffi::parcel_asset_set_pipeline(self.raw, ptr::null(), 0) },
      Some(p) => {
        let b = p.as_bytes();
        unsafe { ffi::parcel_asset_set_pipeline(self.raw, b.as_ptr(), b.len()) };
      }
    }
  }

  // ── BundleBehavior ────────────────────────────────────────────────────────

  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { ffi::parcel_asset_get_bundle_behavior(self.raw) }
  }

  pub fn set_bundle_behavior(&mut self, behavior: BundleBehavior) {
    unsafe { ffi::parcel_asset_set_bundle_behavior(self.raw, behavior) };
  }

  // ── Flags ─────────────────────────────────────────────────────────────────

  pub fn flags(&self) -> AssetFlags {
    unsafe { ffi::parcel_asset_get_flags(self.raw) }
  }

  pub fn set_flags(&mut self, flags: AssetFlags) {
    unsafe { ffi::parcel_asset_set_flags(self.raw, flags) };
  }

  /// Returns `true` if all bits in `mask` are set.
  pub fn has_flag(&self, mask: AssetFlags) -> bool {
    self.flags().contains(mask)
  }

  // ── UniqueKey ─────────────────────────────────────────────────────────────

  /// Returns the unique key, or `None` if not set.
  pub fn unique_key(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_unique_key(&mut buf, self.raw) };
    buf.to_string()
  }

  /// Sets the unique key.  Pass `None` to clear.
  pub fn set_unique_key(&mut self, key: Option<&str>) {
    match key {
      None => unsafe { ffi::parcel_asset_set_unique_key(self.raw, ptr::null(), 0) },
      Some(k) => {
        let b = k.as_bytes();
        unsafe { ffi::parcel_asset_set_unique_key(self.raw, b.as_ptr(), b.len()) };
      }
    }
  }

  // ── Target (read-only) ────────────────────────────────────────────────────

  /// Returns the target configuration for this asset.
  pub fn target(&self) -> Target {
    Target {
      raw: unsafe { ffi::parcel_asset_get_target(self.raw) },
      options: self.options,
    }
  }

  // ── Dependencies ─────────────────────────────────────────────────────────

  /// Appends a dependency.  The dependency inherits the asset's target.
  pub fn add_dependency(&mut self, dep: DependencyOptions) {
    let b = dep.specifier.as_bytes();
    let raw = ffi::DependencyOptions {
      specifier: b.as_ptr(),
      specifier_len: b.len(),
      specifier_type: dep.specifier_type,
      priority: dep.priority,
      bundle_behavior: dep.bundle_behavior,
      flags: dep.flags,
    };
    unsafe { ffi::parcel_asset_add_dependency(self.raw, &raw) };
  }

  // ── Symbols ───────────────────────────────────────────────────────────────

  /// Registers an exported symbol name (e.g. `"default"`, `"foo"`, `"*"`).
  pub fn add_export_symbol(&mut self, name: &str) {
    let b = name.as_bytes();
    unsafe { ffi::parcel_asset_add_export_symbol(self.raw, b.as_ptr(), b.len()) };
  }
}

fn type_id<T: 'static>() -> [u8; 16] {
  let ty = TypeId::of::<T>();
  let slice = unsafe { std::slice::from_raw_parts(&ty as *const TypeId as *const u8, 16) };
  slice.try_into().unwrap()
}

pub enum ContentBuffer {
  Bytes(Vec<u8>),
  String(String),
}

pub trait AssetContent: Send + Sync + 'static {
  fn read(&self) -> Result<ContentBuffer, Diagnostic>;

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    options: &Options,
  ) -> Result<ContentBuffer, Diagnostic>;
}

// ── Bundle graph ───────────────────────────────────────────────────────────

/// Read-only view of the bundle graph during packaging.
pub struct BundleGraph {
  raw: ffi::BundleGraph,
  options: ffi::Options,
}

impl BundleGraph {
  /// Wraps the raw bundle graph handle supplied by Parcel.
  ///
  /// # Safety
  /// `raw` and `options` must be the handles supplied to the package callback.
  pub unsafe fn from_raw(raw: ffi::BundleGraph, options: ffi::Options) -> Self {
    Self { raw, options }
  }

  pub fn asset_count(&self) -> usize {
    unsafe { ffi::parcel_bundle_graph_get_asset_count(self.raw) }
  }

  pub fn asset<'a>(&'a self, index: AssetIndex) -> Option<AssetRef<'a>> {
    let raw = unsafe { ffi::parcel_bundle_graph_get_asset(self.raw, index) };
    (raw != 0).then_some(AssetRef {
      raw,
      options: self.options,
      index,
      phantom: PhantomData,
    })
  }

  pub fn assets<'a>(&'a self) -> impl Iterator<Item = AssetRef<'a>> + 'a {
    (0..self.asset_count()).filter_map(|index| self.asset(index as AssetIndex))
  }

  pub fn bundle_count(&self) -> usize {
    unsafe { ffi::parcel_bundle_graph_get_bundle_count(self.raw) }
  }

  pub fn bundle(&self, index: BundleIndex) -> Option<Bundle> {
    let raw = unsafe { ffi::parcel_bundle_graph_get_bundle(self.raw, index) };
    (raw != 0).then_some(Bundle {
      raw,
      options: self.options,
    })
  }

  pub fn bundles(&self) -> impl Iterator<Item = Bundle> + '_ {
    (0..self.bundle_count()).filter_map(|index| self.bundle(index))
  }

  pub fn dependency_resolution(
    &self,
    asset: AssetIndex,
    dependency_index: usize,
  ) -> BundleGraphDependencyResolution {
    let resolution = unsafe {
      ffi::parcel_bundle_graph_get_dependency_resolution(self.raw, asset, dependency_index)
    };
    match resolution.resolution_type {
      ffi::BundleGraphResolutionType::Invalid => BundleGraphDependencyResolution::Invalid,
      ffi::BundleGraphResolutionType::None => BundleGraphDependencyResolution::None,
      ffi::BundleGraphResolutionType::Deferred => BundleGraphDependencyResolution::Deferred,
      ffi::BundleGraphResolutionType::External => BundleGraphDependencyResolution::External,
      ffi::BundleGraphResolutionType::Excluded => BundleGraphDependencyResolution::Excluded,
      ffi::BundleGraphResolutionType::Asset => {
        BundleGraphDependencyResolution::Asset(resolution.asset)
      }
      ffi::BundleGraphResolutionType::Bundle => {
        BundleGraphDependencyResolution::Bundle(resolution.bundle)
      }
    }
  }
}

/// Read-only view of an asset in a [`BundleGraph`].
pub struct AssetRef<'a> {
  raw: ffi::Asset,
  options: ffi::Options,
  index: AssetIndex,
  phantom: PhantomData<&'a ()>,
}

impl<'a> AssetRef<'a> {
  pub fn index(&self) -> AssetIndex {
    self.index
  }

  pub fn content(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_content(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn content_bytes(&self) -> Vec<u8> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_content(&mut buf, self.raw) };
    buf.to_bytes().unwrap_or_default()
  }

  pub fn custom_content<T: AssetContent>(&self) -> Option<&'a T> {
    let mut ty = [0; 16];
    let mut content = std::ptr::null_mut();
    unsafe {
      if !ffi::parcel_asset_get_custom_content(&mut ty, &mut content, self.raw) {
        return None;
      }
      if !content.is_null() {
        let expected_ty = type_id::<T>();
        if ty != expected_ty {
          return None;
        }
        return Some(&*(content as *const T));
      }
    }

    None
  }

  pub fn asset_type(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_type(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn file_path(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_file_path(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  pub fn pipeline(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_pipeline(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { ffi::parcel_asset_get_bundle_behavior(self.raw) }
  }

  pub fn flags(&self) -> AssetFlags {
    unsafe { ffi::parcel_asset_get_flags(self.raw) }
  }

  pub fn has_flag(&self, mask: AssetFlags) -> bool {
    self.flags().contains(mask)
  }

  pub fn unique_key(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_asset_get_unique_key(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn target(&self) -> Target {
    Target {
      raw: unsafe { ffi::parcel_asset_get_target(self.raw) },
      options: self.options,
    }
  }

  pub fn dependency_count(&self) -> usize {
    unsafe { ffi::parcel_asset_get_dependency_count(self.raw) }
  }

  pub fn dependency(&self, index: usize) -> Option<Dependency> {
    let raw = unsafe { ffi::parcel_asset_get_dependency(self.raw, index) };
    (raw != 0).then_some(Dependency {
      raw,
      options: self.options,
    })
  }

  pub fn dependencies(&self) -> impl Iterator<Item = Dependency> + '_ {
    (0..self.dependency_count()).filter_map(|index| self.dependency(index))
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BundleGraphDependencyResolution {
  Invalid,
  None,
  Deferred,
  External,
  Excluded,
  Asset(AssetIndex),
  Bundle(BundleIndex),
}

// ── Bundle ─────────────────────────────────────────────────────────────────

/// Read-only view of a bundle during packaging.
pub struct Bundle {
  raw: ffi::Bundle,
  options: ffi::Options,
}

impl Bundle {
  /// Wraps the raw bundle handle supplied by Parcel.
  ///
  /// # Safety
  /// `raw` and `options` must be the handles supplied to the package callback.
  pub unsafe fn from_raw(raw: ffi::Bundle, options: ffi::Options) -> Self {
    Self { raw, options }
  }

  pub fn asset_type(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_bundle_get_type(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn target(&self) -> Target {
    Target {
      raw: unsafe { ffi::parcel_bundle_get_target(self.raw) },
      options: self.options,
    }
  }

  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { ffi::parcel_bundle_get_bundle_behavior(self.raw) }
  }

  pub fn flags(&self) -> BundleFlags {
    unsafe { ffi::parcel_bundle_get_flags(self.raw) }
  }

  pub fn has_flag(&self, flag: BundleFlags) -> bool {
    self.flags().contains(flag)
  }

  pub fn dist_path(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_bundle_get_dist_path(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn asset_count(&self) -> usize {
    unsafe { ffi::parcel_bundle_get_asset_count(self.raw) }
  }

  pub fn asset(&self, index: usize) -> Option<AssetIndex> {
    let asset = unsafe { ffi::parcel_bundle_get_asset(self.raw, index) };
    (asset != ffi::PARCEL_INVALID_ASSET_INDEX).then_some(asset)
  }

  pub fn assets(&self) -> impl Iterator<Item = AssetIndex> + '_ {
    (0..self.asset_count()).filter_map(|index| self.asset(index))
  }

  pub fn entry_asset_count(&self) -> usize {
    unsafe { ffi::parcel_bundle_get_entry_asset_count(self.raw) }
  }

  pub fn entry_asset(&self, index: usize) -> Option<AssetIndex> {
    let asset = unsafe { ffi::parcel_bundle_get_entry_asset(self.raw, index) };
    (asset != ffi::PARCEL_INVALID_ASSET_INDEX).then_some(asset)
  }

  pub fn entry_assets(&self) -> impl Iterator<Item = AssetIndex> + '_ {
    (0..self.entry_asset_count()).filter_map(|index| self.entry_asset(index))
  }

  pub fn main_entry_asset(&self) -> Option<AssetIndex> {
    let asset = unsafe { ffi::parcel_bundle_get_main_entry_asset(self.raw) };
    (asset != ffi::PARCEL_INVALID_ASSET_INDEX).then_some(asset)
  }

  pub fn name(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_bundle_get_name(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn absolute_url(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_bundle_get_absolute_url(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn relative_url(&self, from: &Bundle) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_bundle_get_relative_url(&mut buf, self.raw, from.raw) };
    buf.to_string()
  }

  pub fn relative_specifier(&self, from: &Bundle) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_bundle_get_relative_specifier(&mut buf, self.raw, from.raw) };
    buf.to_string()
  }
}

// ── Target ─────────────────────────────────────────────────────────────────

/// Read-only view of the build target associated with an asset.
///
/// Obtain via [`Asset::target`].
pub struct Target {
  raw: u64,
  options: u64,
}

impl Target {
  /// Returns the target execution environment.
  pub fn environment(&self) -> Environment {
    unsafe { ffi::parcel_target_get_environment(self.raw) }
  }

  /// Returns the output module format.
  pub fn output_format(&self) -> OutputFormat {
    unsafe { ffi::parcel_target_get_output_format(self.raw) }
  }

  /// Returns the source type (module or script).
  pub fn source_type(&self) -> SourceType {
    unsafe { ffi::parcel_target_get_source_type(self.raw) }
  }

  /// Returns the environment flags bitfield.
  pub fn env_flags(&self) -> EnvironmentFlags {
    unsafe { ffi::parcel_target_get_env_flags(self.raw) }
  }

  /// Returns the public URL (e.g. `"/"` or `"https://cdn.example.com/"`).
  pub fn public_url(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_target_get_public_url(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the absolute path of the dist directory.
  pub fn dist_dir(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_target_get_dist_dir(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }
}

// ── Dependency ─────────────────────────────────────────────────────────────

/// Read-only view of a Parcel dependency.
///
/// Passed to the function registered with [`register_resolver!`] and returned
/// by [`AssetRef::dependency`].
pub struct Dependency {
  raw: u64,
  options: u64,
}

impl Dependency {
  /// Wraps the raw dependency handle supplied by Parcel.
  ///
  /// # Safety
  /// `raw` must be the pointer supplied by Parcel and `options` must be the
  /// opaque options handle supplied alongside it.
  pub unsafe fn from_raw(raw: u64, options: u64) -> Self {
    Dependency { raw, options }
  }

  /// Returns the raw specifier string (e.g. `"custom:greeting"`).
  pub fn specifier(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_dep_get_specifier(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the specifier type.
  pub fn specifier_type(&self) -> SpecifierType {
    unsafe { ffi::parcel_dep_get_specifier_type(self.raw) }
  }

  /// Returns the dependency priority.
  pub fn priority(&self) -> Priority {
    unsafe { ffi::parcel_dep_get_priority(self.raw) }
  }

  /// Returns the bundle behavior.
  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { ffi::parcel_dep_get_bundle_behavior(self.raw) }
  }

  /// Returns the raw `DependencyFlags` bitfield.
  pub fn flags(&self) -> DependencyFlags {
    unsafe { ffi::parcel_dep_get_flags(self.raw) }
  }

  /// Returns the absolute path of the file that contains this import.
  pub fn source_path(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_dep_get_source_path(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the base path for resolving the specifier (falls back to the
  /// source file path when `resolve_from` is not explicitly set).
  pub fn resolve_from(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { ffi::parcel_dep_get_resolve_from(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the target configuration for this dependency.
  pub fn target(&self) -> Target {
    Target {
      raw: unsafe { ffi::parcel_dep_get_target(self.raw) },
      options: self.options,
    }
  }
}

// ── ResolveResult ──────────────────────────────────────────────────────────

/// Used by resolver plugins to record the resolution outcome.
///
/// Call one of the setter methods, or return without calling any to pass
/// to the next resolver.
pub struct ResolveResult {
  raw: u64,
}

impl ResolveResult {
  /// Wraps the raw result pointer supplied by Parcel.
  ///
  /// # Safety
  /// `raw` must be the `*mut RawResolveResult` pointer supplied by Parcel,
  /// cast to `u64`.
  pub unsafe fn from_raw(raw: u64) -> Self {
    ResolveResult { raw }
  }

  fn raw_ptr(&self) -> *mut ffi::ResolveResult {
    self.raw as *mut ffi::ResolveResult
  }

  /// Records that the specifier resolved to the given absolute file path.
  ///
  /// The bytes are copied into a host-allocated Buffer via `parcel_buffer_alloc`.
  pub fn set_file_path(&mut self, path: &str) {
    let bytes = path.as_bytes();
    unsafe {
      (*self.raw_ptr()).resolution_type = ffi::ResolutionType::FilePath;
      (*self.raw_ptr()).file_path = ffi::parcel_buffer_alloc(bytes.as_ptr(), bytes.len());
    }
  }

  /// Optionally sets the transformer pipeline for the resolved asset.
  ///
  /// The bytes are copied into a host-allocated Buffer via `parcel_buffer_alloc`.
  pub fn set_pipeline(&mut self, pipeline: &str) {
    let bytes = pipeline.as_bytes();
    unsafe { (*self.raw_ptr()).pipeline = ffi::parcel_buffer_alloc(bytes.as_ptr(), bytes.len()) };
  }

  /// Marks the dependency as external (not bundled).
  pub fn set_external(&mut self) {
    unsafe { (*self.raw_ptr()).resolution_type = ffi::ResolutionType::External };
  }

  /// Marks the dependency as excluded (silently dropped).
  pub fn set_excluded(&mut self) {
    unsafe { (*self.raw_ptr()).resolution_type = ffi::ResolutionType::Excluded };
  }
}

// ── Plugin trait ──────────────────────────────────────────────────────────

/// The single trait to implement for any Parcel plugin.
///
/// Override [`transform`] to act as a transformer, [`resolve`] to act as a
/// resolver, or both.  The default implementations return an error, so Parcel
/// surfaces a clear message if a method is unexpectedly called.
///
/// [`transform`]: Plugin::transform
/// [`resolve`]: Plugin::resolve
///
/// ```rust,ignore
/// use parcel_plugin::{Asset, Diagnostic, Plugin, register_plugin};
///
/// struct MyPlugin { prefix: String }
///
/// impl Plugin for MyPlugin {
///     fn new(config: &[u8]) -> Result<Self, Diagnostic> {
///         // parse config, e.g. via serde_json
///         Ok(MyPlugin { prefix: "hello".into() })
///     }
///     fn transform(&self, asset: &mut Asset, _options: &Options) -> Result<(), Diagnostic> {
///         asset.set_content(format!("{}: {}", self.prefix, asset.content()));
///         Ok(())
///     }
/// }
///
/// register_plugin!(MyPlugin);
/// ```
pub trait Plugin: Sized + Send + Sync {
  /// Called once when the plugin is loaded.  `config` is the UTF-8 JSON bytes
  /// of the plugin's config object (empty slice when no config was provided).
  fn new(config: &[u8]) -> Result<Self, Diagnostic>;

  /// Called once per asset that matches the plugin's configured glob.
  /// The default returns an error; override when acting as a transformer.
  fn transform(&self, _asset: &mut Asset, _options: &Options) -> Result<(), Diagnostic> {
    Err(Diagnostic::new("transform not implemented"))
  }

  /// Called for each dependency that reaches this resolver.
  /// The default returns an error; override when acting as a resolver.
  fn resolve(
    &self,
    _dep: &Dependency,
    _specifier: &str,
    _pipeline: Option<&str>,
    _options: &Options,
    _result: &mut ResolveResult,
  ) -> Result<(), Diagnostic> {
    Err(Diagnostic::new("resolve not implemented"))
  }
}

// ── register_plugin! macro ────────────────────────────────────────────────

/// Generates all four ABI exports for a type that implements [`Plugin`]:
/// `parcel_plugin_init`, `parcel_plugin_deinit`, `parcel_plugin_transform`,
/// and `parcel_plugin_resolve`.
///
/// ```rust,ignore
/// register_plugin!(MyPlugin);
/// ```
///
/// `parcel_plugin_init` calls [`Plugin::new`] and boxes the result as the
/// per-instance state pointer.  `parcel_plugin_deinit` drops the box.
/// The transform and resolve exports borrow the box as `&MyPlugin` and
/// delegate to the corresponding trait method.
#[macro_export]
macro_rules! register_plugin {
  ($type:ty) => {
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_init(
      config: *const u8,
      config_len: usize,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) -> *mut ::core::ffi::c_void {
      let config = if config.is_null() || config_len == 0 {
        &[] as &[u8]
      } else {
        unsafe { ::core::slice::from_raw_parts(config, config_len) }
      };
      let __parcel_panic_message =
        |payload: ::std::boxed::Box<dyn ::std::any::Any + Send>| -> String {
          if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_string()
          } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
          } else {
            "unknown panic".to_string()
          }
        };
      let result = ::std::panic::catch_unwind(::std::panic::AssertUnwindSafe(|| {
        <$type as $crate::Plugin>::new(config)
      }));
      match result {
        Ok(Ok(plugin)) => {
          ::std::boxed::Box::into_raw(::std::boxed::Box::new(plugin)) as *mut ::core::ffi::c_void
        }
        Ok(Err(e)) => {
          e.write_to_raw(raw_diagnostic);
          ::core::ptr::null_mut()
        }
        Err(payload) => {
          $crate::Diagnostic::new(format!(
            "plugin panicked in init: {}",
            __parcel_panic_message(payload)
          ))
          .write_to_raw(raw_diagnostic);
          ::core::ptr::null_mut()
        }
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_deinit(state: *mut ::core::ffi::c_void) {
      if !state.is_null() {
        drop(unsafe { ::std::boxed::Box::from_raw(state as *mut $type) });
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_transform(
      raw_asset: u64,
      raw_options: u64,
      state: *mut ::core::ffi::c_void,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) {
      let mut asset = unsafe { $crate::Asset::from_raw(raw_asset, raw_options) };
      let options = unsafe { $crate::Options::from_raw(raw_options) };
      let plugin = unsafe { &*(state as *const $type) };
      let __parcel_panic_message =
        |payload: ::std::boxed::Box<dyn ::std::any::Any + Send>| -> String {
          if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_string()
          } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
          } else {
            "unknown panic".to_string()
          }
        };
      let result = ::std::panic::catch_unwind(::std::panic::AssertUnwindSafe(|| {
        $crate::Plugin::transform(plugin, &mut asset, &options)
      }));
      match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => e.write_to_raw(raw_diagnostic),
        Err(payload) => $crate::Diagnostic::new(format!(
          "plugin panicked in transform: {}",
          __parcel_panic_message(payload)
        ))
        .write_to_raw(raw_diagnostic),
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_resolve(
      raw_dep: u64,
      specifier: *const u8,
      specifier_len: usize,
      pipeline: *const u8,
      pipeline_len: usize,
      raw_options: u64,
      raw_result: u64,
      state: *mut ::core::ffi::c_void,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) {
      let specifier = unsafe {
        ::core::str::from_utf8(::core::slice::from_raw_parts(specifier, specifier_len))
          .unwrap_or("")
      };
      let pipeline = if pipeline.is_null() || pipeline_len == 0 {
        None
      } else {
        unsafe { ::core::str::from_utf8(::core::slice::from_raw_parts(pipeline, pipeline_len)) }
          .ok()
      };
      let dep = unsafe { $crate::Dependency::from_raw(raw_dep, raw_options) };
      let options = unsafe { $crate::Options::from_raw(raw_options) };
      let mut result = unsafe { $crate::ResolveResult::from_raw(raw_result) };
      let plugin = unsafe { &*(state as *const $type) };
      let __parcel_panic_message =
        |payload: ::std::boxed::Box<dyn ::std::any::Any + Send>| -> String {
          if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_string()
          } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
          } else {
            "unknown panic".to_string()
          }
        };
      let result = ::std::panic::catch_unwind(::std::panic::AssertUnwindSafe(|| {
        $crate::Plugin::resolve(plugin, &dep, specifier, pipeline, &options, &mut result)
      }));
      match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => e.write_to_raw(raw_diagnostic),
        Err(payload) => $crate::Diagnostic::new(format!(
          "plugin panicked in resolve: {}",
          __parcel_panic_message(payload)
        ))
        .write_to_raw(raw_diagnostic),
      }
    }
  };
}
