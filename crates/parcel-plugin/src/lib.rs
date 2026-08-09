//! Rust SDK for building Parcel transformer, resolver, namer, and optimizer plugins.
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
//! The macro generates all seven ABI symbols: `parcel_plugin_init` (calls
//! `MyPlugin::new`), `parcel_plugin_deinit` (drops the boxed value),
//! `parcel_plugin_transform`, `parcel_plugin_resolve`, `parcel_plugin_name`,
//! `parcel_plugin_optimize`, and `parcel_plugin_report`. Override only the
//! methods you need; the default implementations return an error so
//! misconfiguration is visible immediately.
//!
//! Plugins need no linker configuration. Parcel passes a table of host functions
//! to `parcel_plugin_init`, which [`register_plugin!`] stores before calling your
//! [`Plugin::new`], so the library has no undefined symbols to resolve at load
//! time on any platform.
//!
//! `register_plugin!` checks at startup that Parcel implements the same plugin
//! ABI this SDK was built against, and that its table is at least as large, so a
//! plugin built against a newer SDK reports a version mismatch instead of
//! reading a field Parcel never filled in.

use std::any::{Any, TypeId};
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::path::PathBuf;
use std::ptr;

pub mod api;
pub mod ffi;

use api::host;
pub use api::init_api;

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
      unsafe { host!(free_buffer)(self as *mut Buffer) };
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
pub struct Options<'a> {
  raw: u64,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Options<'a> {
  pub unsafe fn from_raw(raw: u64) -> Self {
    Options {
      raw,
      lifetime: PhantomData,
    }
  }

  /// Returns the absolute project root path.
  pub fn project_root(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(options_get_project_root)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Looks up `key` in the build environment map. Returns `None` if not set.
  pub fn env(&self, key: &str) -> Option<String> {
    let mut buf = Buffer::default();
    let b = key.as_bytes();
    unsafe { host!(options_get_env)(&mut buf, self.raw, b.as_ptr(), b.len()) };
    buf.to_string()
  }

  /// Logs a message to whatever reporters the build has configured.
  ///
  /// Available from every plugin method, not just [`Plugin::report`]. Dropped
  /// when the build has no reporters, or when `level` is below its log level.
  pub fn log(&self, level: LogLevel, message: impl AsRef<str>) {
    let message = message.as_ref().as_bytes();
    unsafe { host!(options_log)(self.raw, level, message.as_ptr(), message.len()) };
  }

  /// Logs a diagnostic without failing the build — how a plugin raises a
  /// warning, as opposed to returning `Err`, which ends the build.
  ///
  /// The log level comes from the diagnostic's own severity.
  pub fn log_diagnostic(&self, diagnostic: &Diagnostic) {
    // Filled and dropped here: the host copies what it needs rather than taking
    // ownership, unlike the diagnostic a plugin method returns. Dropping the
    // `Buffer`s is what frees them.
    let mut raw = ffi::Diagnostic {
      message: Buffer::default(),
      file_path: Buffer::default(),
      line: 0,
      column: 0,
      hint: Buffer::default(),
      severity: DiagnosticSeverity::default(),
    };
    diagnostic.write_to_raw(&mut raw);
    unsafe { host!(options_log_diagnostic)(self.raw, &raw) };
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

/// Conditions used when resolving package `exports` and `imports` fields.
pub use ffi::ExportsConditions;

impl ExportsConditions {
  pub fn contains(self, other: ExportsConditions) -> bool {
    self.0 & other.0 == other.0
  }
}

impl Default for ExportsConditions {
  fn default() -> Self {
    ExportsConditions(0)
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
  pub conditions: ExportsConditions,
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
      (*raw).message = host!(buffer_alloc)(self.message.as_ptr(), self.message.len());
      (*raw).severity = self.severity;
      if let Some(fp) = &self.file_path {
        (*raw).file_path = host!(buffer_alloc)(fp.as_ptr(), fp.len());
      }
      (*raw).line = self.line;
      (*raw).column = self.column;
      if let Some(hint) = &self.hint {
        (*raw).hint = host!(buffer_alloc)(hint.as_ptr(), hint.len());
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

// ── Reporter events ────────────────────────────────────────────────────────

/// The level of a log event.
pub use ffi::LogLevel;

impl Default for LogLevel {
  fn default() -> Self {
    Self::Info
  }
}

/// Something that happened during the build, passed to [`Plugin::report`].
///
/// Non-exhaustive: match with a catch-all arm, so a plugin keeps working when
/// Parcel adds an event it does not know about.
#[non_exhaustive]
pub enum ReportEvent<'a> {
  /// A build is about to start. Emitted once per build, including rebuilds.
  BuildStart,
  BuildSuccess {
    bundle_graph: BundleGraph<'a>,
    /// How long the build took.
    build_time: std::time::Duration,
    /// The assets re-transformed by this build. Empty after a full build,
    /// which transformed all of them.
    changed_assets: &'a [AssetIndex],
  },
  BuildFailure {
    diagnostics: Diagnostics<'a>,
  },
  Log {
    level: LogLevel,
    /// `None` when the event carries diagnostics instead.
    message: Option<&'a str>,
    diagnostics: Option<Diagnostics<'a>>,
  },
}

impl<'a> ReportEvent<'a> {
  /// Reads the event Parcel passed to `parcel_plugin_report`.
  ///
  /// Returns `None` for an event kind this SDK does not know about, which a
  /// plugin built against an older Parcel can be handed.
  ///
  /// # Safety
  ///
  /// `raw` must be the event pointer Parcel supplied, valid for the call.
  pub unsafe fn from_raw(raw: *const ffi::ReportEvent) -> Option<ReportEvent<'a>> {
    if raw.is_null() {
      return None;
    }
    let event = unsafe { &*raw };

    let diagnostics = (event.diagnostics != 0).then(|| Diagnostics {
      raw: event.diagnostics,
      lifetime: PhantomData,
    });

    Some(match event.event_type {
      ffi::ReportEventType::BuildStart => ReportEvent::BuildStart,
      ffi::ReportEventType::BuildSuccess => ReportEvent::BuildSuccess {
        bundle_graph: unsafe { BundleGraph::from_raw(event.bundle_graph, 0) },
        build_time: std::time::Duration::from_millis(event.build_time_ms),
        changed_assets: if event.changed_assets.is_null() {
          &[]
        } else {
          unsafe { std::slice::from_raw_parts(event.changed_assets, event.changed_asset_count) }
        },
      },
      ffi::ReportEventType::BuildFailure => ReportEvent::BuildFailure {
        diagnostics: diagnostics?,
      },
      ffi::ReportEventType::Log => ReportEvent::Log {
        level: event.level,
        message: (!event.message.is_null()).then(|| unsafe {
          std::str::from_utf8_unchecked(std::slice::from_raw_parts(
            event.message,
            event.message_len,
          ))
        }),
        diagnostics,
      },
    })
  }
}

/// The diagnostics carried by a [`ReportEvent`].
pub struct Diagnostics<'a> {
  raw: ffi::Diagnostics,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Diagnostics<'a> {
  pub fn len(&self) -> usize {
    unsafe { host!(diagnostics_get_count)(self.raw) }
  }

  pub fn is_empty(&self) -> bool {
    self.len() == 0
  }

  pub fn get(&self, index: usize) -> Option<DiagnosticInfo<'_>> {
    (index < self.len()).then(|| DiagnosticInfo {
      diagnostics: self,
      index,
    })
  }

  pub fn iter(&self) -> impl Iterator<Item = DiagnosticInfo<'_>> + '_ {
    (0..self.len()).filter_map(|index| self.get(index))
  }
}

/// One diagnostic within a [`Diagnostics`] list.
pub struct DiagnosticInfo<'a> {
  diagnostics: &'a Diagnostics<'a>,
  index: usize,
}

impl DiagnosticInfo<'_> {
  pub fn message(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(diagnostic_get_message)(&mut buf, self.diagnostics.raw, self.index) };
    buf.to_string().unwrap_or_default()
  }

  pub fn severity(&self) -> DiagnosticSeverity {
    unsafe { host!(diagnostic_get_severity)(self.diagnostics.raw, self.index) }
  }

  /// The plugin the diagnostic came from, if it recorded one.
  pub fn origin(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(diagnostic_get_origin)(&mut buf, self.diagnostics.raw, self.index) };
    buf.to_string()
  }

  pub fn hints(&self) -> Vec<String> {
    let count = unsafe { host!(diagnostic_get_hint_count)(self.diagnostics.raw, self.index) };
    (0..count)
      .map(|hint| {
        let mut buf = Buffer::default();
        unsafe { host!(diagnostic_get_hint)(&mut buf, self.diagnostics.raw, self.index, hint) };
        buf.to_string().unwrap_or_default()
      })
      .collect()
  }
}

// ── Asset ──────────────────────────────────────────────────────────────────

/// A handle to the asset being transformed.
///
/// Every method forwards to the corresponding `parcel_asset_*` ABI function.
/// The handle is valid only for the duration of the transformer call.
pub struct Asset<'a> {
  raw: u64,
  options: u64,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Asset<'a> {
  /// Wraps the raw Parcel asset handle. Called by [`register_plugin!`].
  ///
  /// # Safety
  ///
  /// `raw` must be the opaque asset pointer supplied by Parcel, and
  /// `options` must be the opaque options handle supplied alongside it.
  pub unsafe fn from_raw(raw: u64, options: u64) -> Self {
    Asset {
      raw,
      options,
      lifetime: PhantomData,
    }
  }

  // ── Content ──────────────────────────────────────────────────────────────

  /// Returns the asset source content as a UTF-8 string.
  pub fn content(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_content)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the asset source content as raw bytes.
  pub fn content_bytes(&self) -> Vec<u8> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_content)(&mut buf, self.raw) };
    buf.to_bytes().unwrap_or_default()
  }

  /// Replaces the asset content with a UTF-8 string.
  pub fn set_content(&mut self, content: impl AsRef<str>) {
    let bytes = content.as_ref().as_bytes();
    unsafe { host!(asset_set_content_utf8)(self.raw, bytes.as_ptr(), bytes.len() as u32) };
  }

  /// Replaces the asset content with raw bytes.
  pub fn set_content_bytes(&mut self, bytes: &[u8]) {
    unsafe { host!(asset_set_content)(self.raw, bytes.as_ptr(), bytes.len() as u32) };
  }

  pub fn set_custom_content<T: AssetContent>(&mut self, content: T) {
    unsafe extern "C" fn read_content<T: AssetContent>(
      content: *const c_void,
      buf: *mut Buffer,
      diagnostic: *mut ffi::Diagnostic,
    ) {
      let content = unsafe { &*(content as *const T) as &T };
      let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| content.read()));
      match result {
        Ok(Ok(ContentBuffer::Bytes(b))) => {
          unsafe { host!(buffer_write)(buf, b.as_ptr(), b.len()) };
        }
        Ok(Ok(ContentBuffer::String(s))) => {
          unsafe { host!(buffer_write_utf8)(buf, s.as_bytes().as_ptr(), s.len()) };
        }
        Ok(Err(e)) => {
          e.write_to_raw(diagnostic);
        }
        Err(payload) => Diagnostic::new(format!(
          "plugin panicked in custom content read: {}",
          panic_message(payload)
        ))
        .write_to_raw(diagnostic),
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
      let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        content.package(&bundle_graph, &bundle, &options)
      }));
      match result {
        Ok(Ok(ContentBuffer::Bytes(b))) => {
          unsafe { host!(buffer_write)(buf, b.as_ptr(), b.len()) };
        }
        Ok(Ok(ContentBuffer::String(s))) => {
          unsafe { host!(buffer_write_utf8)(buf, s.as_bytes().as_ptr(), s.len()) };
        }
        Ok(Err(e)) => {
          e.write_to_raw(diagnostic);
        }
        Err(payload) => Diagnostic::new(format!(
          "plugin panicked in custom content package: {}",
          panic_message(payload)
        ))
        .write_to_raw(diagnostic),
      }
    }

    unsafe extern "C" fn free_content<T: AssetContent>(content: *mut c_void) {
      drop(unsafe { Box::from_raw(content as *mut T) })
    }

    let ty = type_id::<T>();
    unsafe {
      host!(asset_set_custom_content)(
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
      if !host!(asset_get_custom_content)(&mut ty, &mut content, self.raw) {
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
    unsafe { host!(asset_get_type)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Changes the asset type to the given file extension.
  pub fn set_type(&mut self, ty: &str) {
    let b = ty.as_bytes();
    unsafe { host!(asset_set_type)(self.raw, b.as_ptr(), b.len()) };
  }

  // ── File path (read-only) ─────────────────────────────────────────────────

  /// Returns the absolute filesystem path of the source asset.
  pub fn file_path(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_file_path)(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the query string from the asset's source URL.
  pub fn query(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_query)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  // ── Pipeline ─────────────────────────────────────────────────────────────

  /// Returns the named pipeline, or `None` if not set.
  pub fn pipeline(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_pipeline)(&mut buf, self.raw) };
    buf.to_string()
  }

  /// Sets the named pipeline.  Pass `None` to clear.
  pub fn set_pipeline(&mut self, pipeline: Option<&str>) {
    match pipeline {
      None => unsafe { host!(asset_set_pipeline)(self.raw, ptr::null(), 0) },
      Some(p) => {
        let b = p.as_bytes();
        unsafe { host!(asset_set_pipeline)(self.raw, b.as_ptr(), b.len()) };
      }
    }
  }

  // ── BundleBehavior ────────────────────────────────────────────────────────

  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { host!(asset_get_bundle_behavior)(self.raw) }
  }

  pub fn set_bundle_behavior(&mut self, behavior: BundleBehavior) {
    unsafe { host!(asset_set_bundle_behavior)(self.raw, behavior) };
  }

  // ── Flags ─────────────────────────────────────────────────────────────────

  pub fn flags(&self) -> AssetFlags {
    unsafe { host!(asset_get_flags)(self.raw) }
  }

  pub fn set_flags(&mut self, flags: AssetFlags) {
    unsafe { host!(asset_set_flags)(self.raw, flags) };
  }

  /// Returns `true` if all bits in `mask` are set.
  pub fn has_flag(&self, mask: AssetFlags) -> bool {
    self.flags().contains(mask)
  }

  // ── UniqueKey ─────────────────────────────────────────────────────────────

  /// Returns the unique key, or `None` if not set.
  pub fn unique_key(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_unique_key)(&mut buf, self.raw) };
    buf.to_string()
  }

  /// Sets the unique key.  Pass `None` to clear.
  pub fn set_unique_key(&mut self, key: Option<&str>) {
    match key {
      None => unsafe { host!(asset_set_unique_key)(self.raw, ptr::null(), 0) },
      Some(k) => {
        let b = k.as_bytes();
        unsafe { host!(asset_set_unique_key)(self.raw, b.as_ptr(), b.len()) };
      }
    }
  }

  // ── Target (read-only) ────────────────────────────────────────────────────

  /// Returns the target configuration for this asset.
  pub fn target(&self) -> Target<'a> {
    Target {
      raw: unsafe { host!(asset_get_target)(self.raw) },
      options: self.options,
      lifetime: PhantomData,
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
      conditions: dep.conditions,
    };
    unsafe { host!(asset_add_dependency)(self.raw, &raw) };
  }

  // ── Symbols ───────────────────────────────────────────────────────────────

  /// Registers an exported symbol name (e.g. `"default"`, `"foo"`, `"*"`).
  pub fn add_export_symbol(&mut self, name: &str) {
    let b = name.as_bytes();
    unsafe { host!(asset_add_export_symbol)(self.raw, b.as_ptr(), b.len()) };
  }
}

fn type_id<T: 'static>() -> [u8; 16] {
  let ty = TypeId::of::<T>();
  let slice = unsafe { std::slice::from_raw_parts(&ty as *const TypeId as *const u8, 16) };
  slice.try_into().unwrap()
}

fn panic_message(payload: Box<dyn Any + Send>) -> String {
  if let Some(message) = payload.downcast_ref::<&str>() {
    (*message).to_owned()
  } else if let Some(message) = payload.downcast_ref::<String>() {
    message.clone()
  } else {
    "unknown panic".to_owned()
  }
}

pub enum ContentBuffer {
  Bytes(Vec<u8>),
  String(String),
}

/// Output returned by an optimizer plugin.
pub struct OptimizeResult {
  pub contents: ContentBuffer,
  /// A replacement source map, or `None` to remove the source map.
  pub source_map: Option<Vec<u8>>,
}

impl OptimizeResult {
  pub fn new(contents: ContentBuffer) -> Self {
    Self {
      contents,
      source_map: None,
    }
  }

  pub fn with_source_map(mut self, source_map: impl Into<Vec<u8>>) -> Self {
    self.source_map = Some(source_map.into());
    self
  }
}

impl From<ContentBuffer> for OptimizeResult {
  fn from(contents: ContentBuffer) -> Self {
    Self::new(contents)
  }
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

/// Read-only view of the bundle graph during packaging or naming.
pub struct BundleGraph<'a> {
  raw: ffi::BundleGraph,
  options: ffi::Options,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> BundleGraph<'a> {
  /// Wraps the raw bundle graph handle supplied by Parcel.
  ///
  /// # Safety
  /// `raw` and `options` must be the handles supplied to the package callback.
  pub unsafe fn from_raw(raw: ffi::BundleGraph, options: ffi::Options) -> Self {
    Self {
      raw,
      options,
      lifetime: PhantomData,
    }
  }

  pub fn asset_count(&self) -> usize {
    unsafe { host!(bundle_graph_get_asset_count)(self.raw) }
  }

  pub fn asset(&'a self, index: AssetIndex) -> Option<AssetRef<'a>> {
    let raw = unsafe { host!(bundle_graph_get_asset)(self.raw, index) };
    (raw != 0).then_some(AssetRef {
      raw,
      options: self.options,
      index,
      phantom: PhantomData,
    })
  }

  pub fn assets(&'a self) -> impl Iterator<Item = AssetRef<'a>> + 'a {
    (0..self.asset_count()).filter_map(|index| self.asset(index as AssetIndex))
  }

  pub fn bundle_count(&self) -> usize {
    unsafe { host!(bundle_graph_get_bundle_count)(self.raw) }
  }

  pub fn bundle(&'a self, index: BundleIndex) -> Option<Bundle<'a>> {
    let raw = unsafe { host!(bundle_graph_get_bundle)(self.raw, index) };
    (raw != 0).then_some(Bundle {
      raw,
      options: self.options,
      lifetime: PhantomData,
    })
  }

  pub fn bundles(&'a self) -> impl Iterator<Item = Bundle<'a>> + 'a {
    (0..self.bundle_count()).filter_map(|index| self.bundle(index))
  }

  pub fn dependency_resolution(
    &self,
    asset: AssetIndex,
    dependency_index: usize,
  ) -> BundleGraphDependencyResolution {
    let resolution =
      unsafe { host!(bundle_graph_get_dependency_resolution)(self.raw, asset, dependency_index) };
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
    unsafe { host!(asset_get_content)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn content_bytes(&self) -> Vec<u8> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_content)(&mut buf, self.raw) };
    buf.to_bytes().unwrap_or_default()
  }

  pub fn custom_content<T: AssetContent>(&self) -> Option<&'a T> {
    let mut ty = [0; 16];
    let mut content = std::ptr::null_mut();
    unsafe {
      if !host!(asset_get_custom_content)(&mut ty, &mut content, self.raw) {
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
    unsafe { host!(asset_get_type)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn file_path(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_file_path)(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  pub fn query(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_query)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn pipeline(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_pipeline)(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { host!(asset_get_bundle_behavior)(self.raw) }
  }

  pub fn flags(&self) -> AssetFlags {
    unsafe { host!(asset_get_flags)(self.raw) }
  }

  pub fn has_flag(&self, mask: AssetFlags) -> bool {
    self.flags().contains(mask)
  }

  pub fn unique_key(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_unique_key)(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn target(&'a self) -> Target<'a> {
    Target {
      raw: unsafe { host!(asset_get_target)(self.raw) },
      options: self.options,
      lifetime: PhantomData,
    }
  }

  pub fn dependency_count(&self) -> usize {
    unsafe { host!(asset_get_dependency_count)(self.raw) }
  }

  pub fn dependency(&'a self, index: usize) -> Option<Dependency<'a>> {
    let raw = unsafe { host!(asset_get_dependency)(self.raw, index) };
    (raw != 0).then_some(Dependency {
      raw,
      options: self.options,
      lifetime: PhantomData,
    })
  }

  pub fn dependencies(&'a self) -> impl Iterator<Item = Dependency<'a>> + 'a {
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

/// Read-only view of a bundle during packaging or naming.
pub struct Bundle<'a> {
  raw: ffi::Bundle,
  options: ffi::Options,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Bundle<'a> {
  /// Wraps the raw bundle handle supplied by Parcel.
  ///
  /// # Safety
  /// `raw` and `options` must be the handles supplied to the package callback.
  pub unsafe fn from_raw(raw: ffi::Bundle, options: ffi::Options) -> Self {
    Self {
      raw,
      options,
      lifetime: PhantomData,
    }
  }

  pub fn asset_type(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_type)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn target(&'a self) -> Target<'a> {
    Target {
      raw: unsafe { host!(bundle_get_target)(self.raw) },
      options: self.options,
      lifetime: PhantomData,
    }
  }

  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { host!(bundle_get_bundle_behavior)(self.raw) }
  }

  pub fn flags(&self) -> BundleFlags {
    unsafe { host!(bundle_get_flags)(self.raw) }
  }

  pub fn has_flag(&self, flag: BundleFlags) -> bool {
    self.flags().contains(flag)
  }

  pub fn dist_path(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_dist_path)(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn asset_count(&self) -> usize {
    unsafe { host!(bundle_get_asset_count)(self.raw) }
  }

  pub fn asset(&self, index: usize) -> Option<AssetIndex> {
    let asset = unsafe { host!(bundle_get_asset)(self.raw, index) };
    (asset != ffi::PARCEL_INVALID_ASSET_INDEX).then_some(asset)
  }

  pub fn assets(&self) -> impl Iterator<Item = AssetIndex> + '_ {
    (0..self.asset_count()).filter_map(|index| self.asset(index))
  }

  pub fn entry_asset_count(&self) -> usize {
    unsafe { host!(bundle_get_entry_asset_count)(self.raw) }
  }

  pub fn entry_asset(&self, index: usize) -> Option<AssetIndex> {
    let asset = unsafe { host!(bundle_get_entry_asset)(self.raw, index) };
    (asset != ffi::PARCEL_INVALID_ASSET_INDEX).then_some(asset)
  }

  pub fn entry_assets(&self) -> impl Iterator<Item = AssetIndex> + '_ {
    (0..self.entry_asset_count()).filter_map(|index| self.entry_asset(index))
  }

  pub fn main_entry_asset(&self) -> Option<AssetIndex> {
    let asset = unsafe { host!(bundle_get_main_entry_asset)(self.raw) };
    (asset != ffi::PARCEL_INVALID_ASSET_INDEX).then_some(asset)
  }

  pub fn name(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_name)(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn absolute_url(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_absolute_url)(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn relative_url(&self, from: &Bundle) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_relative_url)(&mut buf, self.raw, from.raw) };
    buf.to_string()
  }

  pub fn relative_specifier(&self, from: &Bundle) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_relative_specifier)(&mut buf, self.raw, from.raw) };
    buf.to_string()
  }
}

// ── Target ─────────────────────────────────────────────────────────────────

/// Read-only view of the build target associated with an asset.
///
/// Obtain via [`Asset::target`].
pub struct Target<'a> {
  raw: u64,
  options: u64,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Target<'a> {
  /// Returns the target execution environment.
  pub fn environment(&self) -> Environment {
    unsafe { host!(target_get_environment)(self.raw) }
  }

  /// Returns the output module format.
  pub fn output_format(&self) -> OutputFormat {
    unsafe { host!(target_get_output_format)(self.raw) }
  }

  /// Returns the source type (module or script).
  pub fn source_type(&self) -> SourceType {
    unsafe { host!(target_get_source_type)(self.raw) }
  }

  /// Returns the environment flags bitfield.
  pub fn env_flags(&self) -> EnvironmentFlags {
    unsafe { host!(target_get_env_flags)(self.raw) }
  }

  /// Returns the public URL (e.g. `"/"` or `"https://cdn.example.com/"`).
  pub fn public_url(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(target_get_public_url)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the absolute path of the dist directory.
  pub fn dist_dir(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(target_get_dist_dir)(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }
}

// ── Dependency ─────────────────────────────────────────────────────────────

/// Read-only view of a Parcel dependency.
///
/// Passed to the function registered with [`register_resolver!`] and returned
/// by [`AssetRef::dependency`].
pub struct Dependency<'a> {
  raw: u64,
  options: u64,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Dependency<'a> {
  /// Wraps the raw dependency handle supplied by Parcel.
  ///
  /// # Safety
  /// `raw` must be the pointer supplied by Parcel and `options` must be the
  /// opaque options handle supplied alongside it.
  pub unsafe fn from_raw(raw: u64, options: u64) -> Self {
    Dependency {
      raw,
      options,
      lifetime: PhantomData,
    }
  }

  /// Returns the raw specifier string (e.g. `"custom:greeting"`).
  pub fn specifier(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(dep_get_specifier)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the specifier type.
  pub fn specifier_type(&self) -> SpecifierType {
    unsafe { host!(dep_get_specifier_type)(self.raw) }
  }

  /// Returns the dependency priority.
  pub fn priority(&self) -> Priority {
    unsafe { host!(dep_get_priority)(self.raw) }
  }

  /// Returns the bundle behavior.
  pub fn bundle_behavior(&self) -> BundleBehavior {
    unsafe { host!(dep_get_bundle_behavior)(self.raw) }
  }

  /// Returns the raw `DependencyFlags` bitfield.
  pub fn flags(&self) -> DependencyFlags {
    unsafe { host!(dep_get_flags)(self.raw) }
  }

  /// Returns the package `exports` and `imports` conditions bitfield.
  pub fn conditions(&self) -> ExportsConditions {
    unsafe { host!(dep_get_conditions)(self.raw) }
  }

  /// Returns the absolute path of the file that contains this import.
  pub fn source_path(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(dep_get_source_path)(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the base path for resolving the specifier (falls back to the
  /// source file path when `resolve_from` is not explicitly set).
  pub fn resolve_from(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(dep_get_resolve_from)(&mut buf, self.raw, self.options) };
    buf.to_string().unwrap_or_default()
  }

  /// Returns the target configuration for this dependency.
  pub fn target(&'a self) -> Target<'a> {
    Target {
      raw: unsafe { host!(dep_get_target)(self.raw) },
      options: self.options,
      lifetime: PhantomData,
    }
  }
}

// ── ResolveResult ──────────────────────────────────────────────────────────

/// The outcome of resolving a dependency.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub enum ResolveResult {
  /// Continue to the next resolver.
  #[default]
  None,
  /// Resolve to an absolute file path, optionally using a transformer pipeline.
  Resolved {
    file_path: PathBuf,
    pipeline: Option<String>,
  },
  /// Treat the dependency as external (not bundled).
  External,
  /// Exclude the dependency from the bundle.
  Excluded,
}

impl From<ResolveResult> for ffi::ResolveResult {
  fn from(result: ResolveResult) -> Self {
    let mut ffi_result = ffi::ResolveResult {
      resolution_type: ffi::ResolutionType::None,
      file_path: Buffer::default(),
      pipeline: Buffer::default(),
    };

    match result {
      ResolveResult::None => {}
      ResolveResult::Resolved {
        file_path,
        pipeline,
      } => {
        ffi_result.resolution_type = ffi::ResolutionType::FilePath;
        let path_bytes = file_path.as_os_str().as_encoded_bytes();
        unsafe {
          host!(buffer_write)(
            &mut ffi_result.file_path,
            path_bytes.as_ptr(),
            path_bytes.len(),
          )
        };
        if let Some(pipeline) = pipeline {
          unsafe {
            host!(buffer_write_utf8)(&mut ffi_result.pipeline, pipeline.as_ptr(), pipeline.len())
          };
        }
      }
      ResolveResult::External => ffi_result.resolution_type = ffi::ResolutionType::External,
      ResolveResult::Excluded => ffi_result.resolution_type = ffi::ResolutionType::Excluded,
    }

    ffi_result
  }
}

// ── Plugin trait ──────────────────────────────────────────────────────────

/// The single trait to implement for any Parcel plugin.
///
/// Override [`transform`] to act as a transformer, [`resolve`] to act as a
/// resolver, [`name`] to act as a namer, [`optimize`] to act as an optimizer, or
/// [`report`] to act as a reporter. The default implementations return an error,
/// so Parcel surfaces a clear message if a method is unexpectedly called.
///
/// [`transform`]: Plugin::transform
/// [`resolve`]: Plugin::resolve
/// [`name`]: Plugin::name
/// [`optimize`]: Plugin::optimize
/// [`report`]: Plugin::report
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
  ) -> Result<ResolveResult, Diagnostic> {
    Err(Diagnostic::new("resolve not implemented"))
  }

  /// Called for each bundle that needs a name. Return a path relative to the
  /// bundle target's dist directory, or `None` to continue to the next namer.
  fn name(
    &self,
    _bundle_graph: &BundleGraph,
    _bundle: &Bundle,
    _options: &Options,
  ) -> Result<Option<String>, Diagnostic> {
    Err(Diagnostic::new("name not implemented"))
  }

  /// Called for each bundle selected by the optimizer pipeline. `contents`
  /// contains the packaged bundle bytes, and `source_map` contains the current
  /// source map when one exists.
  fn optimize(
    &self,
    _bundle_graph: &BundleGraph,
    _bundle: &Bundle,
    _contents: &[u8],
    _source_map: Option<&[u8]>,
    _options: &Options,
  ) -> Result<OptimizeResult, Diagnostic> {
    Err(Diagnostic::new("optimize not implemented"))
  }

  /// Called for each build event. Override when acting as a reporter.
  ///
  /// Returning `Err` reports the diagnostic and moves on: a reporter cannot fail
  /// the build.
  fn report(&self, _event: &ReportEvent, _options: &Options) -> Result<(), Diagnostic> {
    Err(Diagnostic::new("report not implemented"))
  }
}

// ── register_plugin! macro ────────────────────────────────────────────────

/// Generates all seven ABI exports for a type that implements [`Plugin`]:
/// `parcel_plugin_init`, `parcel_plugin_deinit`, `parcel_plugin_transform`,
/// `parcel_plugin_resolve`, `parcel_plugin_name`, `parcel_plugin_optimize`, and
/// `parcel_plugin_report`.
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
      api: *const $crate::ffi::ParcelApi,
      config: *const u8,
      config_len: usize,
      out_state: *mut *mut ::core::ffi::c_void,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) -> $crate::ffi::InitStatus {
      // Must come first: every other SDK call, including writing a diagnostic,
      // goes through this table. Returning Incompatible rather than a message is
      // what keeps that from being circular — Parcel writes the message.
      if !unsafe { $crate::init_api(api) } {
        return $crate::ffi::InitStatus::Incompatible;
      }

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
          if !out_state.is_null() {
            unsafe {
              *out_state = ::std::boxed::Box::into_raw(::std::boxed::Box::new(plugin))
                as *mut ::core::ffi::c_void
            };
          }
          $crate::ffi::InitStatus::Ok
        }
        Ok(Err(e)) => {
          e.write_to_raw(raw_diagnostic);
          $crate::ffi::InitStatus::Error
        }
        Err(payload) => {
          $crate::Diagnostic::new(format!(
            "plugin panicked in init: {}",
            __parcel_panic_message(payload)
          ))
          .write_to_raw(raw_diagnostic);
          $crate::ffi::InitStatus::Error
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
        $crate::Plugin::resolve(plugin, &dep, specifier, pipeline, &options)
      }));
      match result {
        Ok(Ok(result)) => {
          if raw_result != 0 {
            unsafe {
              ::core::ptr::write(
                raw_result as *mut $crate::ffi::ResolveResult,
                $crate::ffi::ResolveResult::from(result),
              )
            };
          }
        }
        Ok(Err(e)) => e.write_to_raw(raw_diagnostic),
        Err(payload) => $crate::Diagnostic::new(format!(
          "plugin panicked in resolve: {}",
          __parcel_panic_message(payload)
        ))
        .write_to_raw(raw_diagnostic),
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_name(
      raw_bundle_graph: u64,
      raw_bundle: u64,
      raw_options: u64,
      raw_name: *mut $crate::ffi::Buffer,
      state: *mut ::core::ffi::c_void,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) {
      let bundle_graph = unsafe { $crate::BundleGraph::from_raw(raw_bundle_graph, raw_options) };
      let bundle = unsafe { $crate::Bundle::from_raw(raw_bundle, raw_options) };
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
        $crate::Plugin::name(plugin, &bundle_graph, &bundle, &options)
      }));
      match result {
        Ok(Ok(Some(name))) => {
          if !raw_name.is_null() {
            unsafe {
              $crate::api::api()
                .buffer_write_utf8
                .expect("Parcel did not provide buffer_write_utf8")(
                raw_name,
                name.as_ptr(),
                name.len(),
              )
            };
          }
        }
        Ok(Ok(None)) => {}
        Ok(Err(e)) => e.write_to_raw(raw_diagnostic),
        Err(payload) => $crate::Diagnostic::new(format!(
          "plugin panicked in name: {}",
          __parcel_panic_message(payload)
        ))
        .write_to_raw(raw_diagnostic),
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_optimize(
      raw_bundle_graph: u64,
      raw_bundle: u64,
      raw_contents: *const u8,
      raw_contents_len: usize,
      raw_source_map: *const u8,
      raw_source_map_len: usize,
      raw_options: u64,
      raw_result: *mut $crate::ffi::OptimizeResult,
      state: *mut ::core::ffi::c_void,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) {
      let bundle_graph = unsafe { $crate::BundleGraph::from_raw(raw_bundle_graph, raw_options) };
      let bundle = unsafe { $crate::Bundle::from_raw(raw_bundle, raw_options) };
      let contents = if raw_contents.is_null() || raw_contents_len == 0 {
        &[]
      } else {
        unsafe { ::core::slice::from_raw_parts(raw_contents, raw_contents_len) }
      };
      let source_map = if raw_source_map.is_null() {
        None
      } else if raw_source_map_len == 0 {
        Some(&[][..])
      } else {
        Some(unsafe { ::core::slice::from_raw_parts(raw_source_map, raw_source_map_len) })
      };
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
        $crate::Plugin::optimize(
          plugin,
          &bundle_graph,
          &bundle,
          contents,
          source_map,
          &options,
        )
      }));
      match result {
        Ok(Ok(result)) => {
          if !raw_result.is_null() {
            match result.contents {
              $crate::ContentBuffer::Bytes(contents) => unsafe {
                $crate::api::api()
                  .buffer_write
                  .expect("Parcel did not provide buffer_write")(
                  &mut (*raw_result).contents,
                  contents.as_ptr(),
                  contents.len(),
                )
              },
              $crate::ContentBuffer::String(contents) => unsafe {
                $crate::api::api()
                  .buffer_write_utf8
                  .expect("Parcel did not provide buffer_write_utf8")(
                  &mut (*raw_result).contents,
                  contents.as_ptr(),
                  contents.len(),
                )
              },
            }
            if let Some(source_map) = result.source_map {
              unsafe {
                $crate::api::api()
                  .buffer_write
                  .expect("Parcel did not provide buffer_write")(
                  &mut (*raw_result).source_map,
                  source_map.as_ptr(),
                  source_map.len(),
                )
              };
            }
          }
        }
        Ok(Err(e)) => e.write_to_raw(raw_diagnostic),
        Err(payload) => $crate::Diagnostic::new(format!(
          "plugin panicked in optimize: {}",
          __parcel_panic_message(payload)
        ))
        .write_to_raw(raw_diagnostic),
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_report(
      raw_event: *const $crate::ffi::ReportEvent,
      raw_options: u64,
      state: *mut ::core::ffi::c_void,
      raw_diagnostic: *mut $crate::ffi::Diagnostic,
    ) {
      // An event kind this SDK predates. Reporting nothing is the only correct
      // thing to do with it.
      let Some(event) = (unsafe { $crate::ReportEvent::from_raw(raw_event) }) else {
        return;
      };
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
        $crate::Plugin::report(plugin, &event, &options)
      }));
      match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => e.write_to_raw(raw_diagnostic),
        Err(payload) => $crate::Diagnostic::new(format!(
          "plugin panicked in report: {}",
          __parcel_panic_message(payload)
        ))
        .write_to_raw(raw_diagnostic),
      }
    }
  };
}
