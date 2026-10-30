//! Rust SDK for building Parcel transformer, resolver, namer, optimizer, and
//! reporter plugins, including transformers that keep their own data on an
//! asset until it is packaged ([`AssetContent`]).
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
//!         asset.set_content(format!("export default {:?};\n", asset.content()?));
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
//! ABI this SDK was built against. Parcel may be older than the SDK and lack host
//! functions added since; the SDK checks for each one when it is called, so a
//! plugin only needs a newer Parcel if it uses one, and then fails with a
//! diagnostic saying so rather than reading a field Parcel never filled in.

use std::any::{Any, TypeId};
use std::marker::PhantomData;
use std::os::raw::c_void;
use std::path::{Path, PathBuf};
use std::ptr;

mod api;
mod entry;
// Generated from plugin.h, which declares more than the SDK uses. Variants of
// the newtype enums keep the names they had as Rust enums.
#[allow(non_upper_case_globals, dead_code)]
mod ffi;

use api::host;

// ── Buffer ─────────────────────────────────────────────────────────────────

use ffi::Buffer;

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

// ── Structs that carry their size ──────────────────────────────────────────
//
// Every struct passed to or from Parcel by pointer starts with `size`, set by
// whoever allocates it, so either side can append fields without breaking the
// other. Parcel may be newer or older than this SDK:
//
// - A struct this SDK hands Parcel is zeroed in full, padding included, before
//   its fields are set. A newer field lands where an older Parcel only expects
//   zero bytes, and it rejects anything else there rather than ignore a setting
//   it does not understand.
// - A struct Parcel filled in is read up to its `size`, with any field past it
//   left zeroed.
// - A struct Parcel allocated is written field by field, never wholesale, so
//   only the fields Parcel declared are touched. Fields appended to the first
//   layout must check `size` before writing.

/// Calls `f` with a zeroed `T` whose `size` is set, built in place so its
/// padding stays zeroed. `T` must be one of the ABI structs, for which every
/// field is valid zeroed.
fn with_sized<T, R>(f: impl FnOnce(&mut T) -> R) -> R {
  let mut value = std::mem::MaybeUninit::<T>::zeroed();
  unsafe { value.as_mut_ptr().cast::<usize>().write(size_of::<T>()) };
  f(unsafe { value.assume_init_mut() })
}

/// Reads a struct Parcel filled in, up to the `size` it reported, leaving any
/// field past that zeroed. `None` when `size` is too small to be any version of
/// the struct, i.e. smaller than `min_size`.
///
/// # Safety
///
/// `raw` must be non-null and point to `(*raw).size` readable bytes, and every
/// field of `T` must be valid zeroed and for any bit pattern.
unsafe fn read_sized<T>(raw: *const T, min_size: usize) -> Option<T> {
  let size = unsafe { raw.cast::<usize>().read() };
  if size < min_size {
    return None;
  }
  let mut value = std::mem::MaybeUninit::<T>::zeroed();
  unsafe {
    ptr::copy_nonoverlapping(
      raw.cast::<u8>(),
      value.as_mut_ptr().cast::<u8>(),
      size.min(size_of::<T>()),
    );
    Some(value.assume_init())
  }
}

// ── Options ────────────────────────────────────────────────────────────────

/// The context of the current plugin call: the build's options, and what the
/// call may do, such as read files Parcel tracks. Every plugin method receives
/// one, borrowed for the call: it cannot be kept for a later one.
pub struct Options<'a> {
  raw: u64,
  lifetime: PhantomData<&'a ()>,
}

impl<'a> Options<'a> {
  pub(crate) unsafe fn from_raw(raw: u64) -> Self {
    Options {
      raw,
      lifetime: PhantomData,
    }
  }

  /// Returns the absolute project root path.
  pub fn project_root(&self) -> PathBuf {
    let mut buf = Buffer::default();
    unsafe { host!(options_get_project_root)(&mut buf, self.raw) };
    PathBuf::from(buf.to_string().unwrap_or_default())
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
    with_sized(|raw: &mut ffi::DiagnosticOptions| {
      unsafe { diagnostic.write_to_raw(raw) };
      unsafe { host!(options_log_diagnostic)(self.raw, raw) };
      unsafe { ptr::drop_in_place(raw) };
    })
  }

  /// Reads the file at the absolute `path`.
  ///
  /// Read files through this rather than `std::fs`: Parcel records the path, so
  /// a change to the file re-runs the transform that read it, and a file that was
  /// missing re-runs it when created. Only available while transforming or
  /// resolving.
  pub fn read_file(&self, path: impl AsRef<Path>) -> std::io::Result<Vec<u8>> {
    let path = path_arg(path.as_ref())?;
    let mut buf = Buffer::default();
    let status = unsafe { host!(fs_read_file)(&mut buf, self.raw, path.as_ptr(), path.len()) };
    match status {
      IoStatus::Ok => Ok(buf.to_bytes().unwrap_or_default()),
      status => Err(io_error(status, buf)),
    }
  }

  /// Reads the file at the absolute `path` as UTF-8. See [`Options::read_file`].
  pub fn read_to_string(&self, path: impl AsRef<Path>) -> std::io::Result<String> {
    String::from_utf8(self.read_file(path)?)
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
  }

  /// Returns what the absolute `path` refers to, or no flags when it does not
  /// exist. Tracked like [`Options::read_file`]: a missing path re-runs the
  /// transform when created, an existing one when deleted.
  pub fn file_kind(&self, path: impl AsRef<Path>) -> FileKind {
    // A path Parcel cannot be asked about is not one of its files.
    let Ok(path) = path_arg(path.as_ref()) else {
      return FileKind::empty();
    };
    unsafe { host!(fs_get_kind)(self.raw, path.as_ptr(), path.len()) }
  }

  /// Returns the absolute `path` with every symlink resolved.
  pub fn canonicalize(&self, path: impl AsRef<Path>) -> std::io::Result<PathBuf> {
    let path = path_arg(path.as_ref())?;
    let mut buf = Buffer::default();
    let status = unsafe { host!(fs_canonicalize)(&mut buf, self.raw, path.as_ptr(), path.len()) };
    match status {
      IoStatus::Ok => Ok(PathBuf::from(buf.to_string().unwrap_or_default())),
      status => Err(io_error(status, buf)),
    }
  }
}

/// `path` as Parcel's path arguments take it: UTF-8, which every path Parcel
/// hands out is.
fn path_arg(path: &Path) -> std::io::Result<&str> {
  path.to_str().ok_or_else(|| {
    std::io::Error::new(
      std::io::ErrorKind::InvalidInput,
      format!("{} is not valid UTF-8", path.display()),
    )
  })
}

/// `path` as a resolver returns it: UTF-8 when it can be, the `bool`, and
/// otherwise, on Unix, where paths are bytes, its bytes. `None` for a path
/// Parcel cannot represent.
fn resolved_path_bytes(path: &Path) -> Option<(&[u8], bool)> {
  if let Some(path) = path.to_str() {
    return Some((path.as_bytes(), true));
  }
  #[cfg(unix)]
  {
    use std::os::unix::ffi::OsStrExt;
    Some((path.as_os_str().as_bytes(), false))
  }
  #[cfg(not(unix))]
  {
    None
  }
}

fn io_error(status: IoStatus, buf: Buffer) -> std::io::Error {
  match status {
    IoStatus::NotFound => std::io::ErrorKind::NotFound.into(),
    _ => std::io::Error::other(buf.to_string().unwrap_or_default()),
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

/// What a dependency evaluates to in the code that imports it.
///
/// A file imported as `JavaScript`, the default, must have a transformer that turns it into
/// JavaScript, or it is an error. Other import types, such as `Url`, can reference any file.
pub use ffi::ImportType;

impl Default for ImportType {
  fn default() -> Self {
    Self::JavaScript
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

/// Bitfield of asset state flags.
pub use ffi::AssetFlags;

/// Bitfield describing bundle state.
pub use ffi::BundleFlags;

pub type AssetIndex = ffi::AssetIndex;
pub type BundleIndex = ffi::BundleIndex;

/// Bitfield of dependency flags.
pub use ffi::DependencyFlags;

/// What a path refers to, as returned by [`Options::file_kind`]. Empty when the
/// path does not exist.
pub use ffi::FileKind;

use ffi::IoStatus;

/// Conditions used when resolving package `exports` and `imports` fields.
pub use ffi::ExportsConditions;

/// Set operations for the bitfield newtypes, like a `bitflags` type's. Each is a
/// `u8` or `u32` newtype with one associated constant per flag, and `|` / `&`.
macro_rules! flags {
  ($($ty:ident),+ $(,)?) => {$(
    impl $ty {
      /// No flags.
      pub const fn empty() -> Self {
        Self(0)
      }

      /// Whether every flag in `other` is set.
      pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
      }

      /// Whether no flag is set.
      pub const fn is_empty(self) -> bool {
        self.0 == 0
      }

      /// Sets the flags in `other`.
      pub fn insert(&mut self, other: Self) {
        self.0 |= other.0;
      }

      /// Clears the flags in `other`.
      pub fn remove(&mut self, other: Self) {
        self.0 &= !other.0;
      }

      /// Sets the flags in `other` when `value`, and clears them otherwise.
      pub fn set(&mut self, other: Self, value: bool) {
        if value {
          self.insert(other);
        } else {
          self.remove(other);
        }
      }
    }

    impl Default for $ty {
      fn default() -> Self {
        Self::empty()
      }
    }

    impl std::ops::Not for $ty {
      type Output = Self;

      fn not(self) -> Self {
        Self(!self.0)
      }
    }
  )+};
}

flags!(
  EnvironmentFlags,
  AssetFlags,
  BundleFlags,
  DependencyFlags,
  FileKind,
  ExportsConditions,
);

/// A dependency to be added to an asset from a transformer.
///
/// Non-exhaustive, so Parcel can add options: build one with [`new`](Self::new)
/// and the builder methods, or set its public fields.
#[derive(Default, Debug)]
#[non_exhaustive]
pub struct DependencyOptions {
  /// Module specifier (e.g. `"./foo.js"` or `"react"`).
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub conditions: ExportsConditions,
  pub import_type: ImportType,
}

impl DependencyOptions {
  /// Creates an ESM sync dependency with default flags.
  pub fn new(specifier: impl Into<String>) -> Self {
    DependencyOptions {
      specifier: specifier.into(),
      ..Default::default()
    }
  }

  /// How the specifier is interpreted.
  pub fn specifier_type(mut self, specifier_type: SpecifierType) -> Self {
    self.specifier_type = specifier_type;
    self
  }

  /// When the dependency is loaded relative to the importing asset.
  pub fn priority(mut self, priority: Priority) -> Self {
    self.priority = priority;
    self
  }

  /// How the dependency's bundle is output.
  pub fn bundle_behavior(mut self, bundle_behavior: BundleBehavior) -> Self {
    self.bundle_behavior = bundle_behavior;
    self
  }

  /// Sets `flags`, in addition to any already set.
  pub fn flags(mut self, flags: DependencyFlags) -> Self {
    self.flags.insert(flags);
    self
  }

  /// Sets `conditions` for resolving package `exports`, in addition to any
  /// already set.
  pub fn conditions(mut self, conditions: ExportsConditions) -> Self {
    self.conditions.insert(conditions);
    self
  }

  /// What the dependency evaluates to in the code that imports it.
  pub fn import_type(mut self, import_type: ImportType) -> Self {
    self.import_type = import_type;
    self
  }

  fn with_raw<R>(&self, f: impl FnOnce(*const ffi::DependencyOptions) -> R) -> R {
    let specifier = self.specifier.as_bytes();
    with_sized(|raw: &mut ffi::DependencyOptions| {
      raw.specifier = specifier.as_ptr();
      raw.specifier_len = specifier.len();
      raw.specifier_type = self.specifier_type;
      raw.priority = self.priority;
      raw.bundle_behavior = self.bundle_behavior;
      raw.flags = self.flags;
      raw.conditions = self.conditions;
      raw.import_type = self.import_type;
      f(raw)
    })
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
///
/// Non-exhaustive, so Parcel can add fields: build one with [`new`](Self::new)
/// or [`warning`](Self::warning) and the builder methods, or set its public
/// fields.
#[derive(Default, Debug)]
#[non_exhaustive]
pub struct Diagnostic {
  pub message: String,
  pub severity: DiagnosticSeverity,
  /// Absolute file path for a source code frame (optional).
  pub file_path: Option<PathBuf>,
  /// 1-based start line for the code highlight (0 = not set).
  pub line: u32,
  /// 1-based start column (0 = not set).
  pub column: u32,
  /// 1-based line of the last highlighted character (0 = just the start).
  pub end_line: u32,
  /// 1-based column of the last highlighted character.
  pub end_column: u32,
  /// A message shown at the code highlight (optional).
  pub highlight_message: Option<String>,
  /// A single hint string (optional).
  pub hint: Option<String>,
  /// A URL to documentation about the diagnostic (optional).
  pub documentation_url: Option<String>,
  /// Diagnostics Parcel reported during this call, such as why a read failed,
  /// which this diagnostic stands for. Returned from a plugin method, it fails
  /// with exactly those, and none of its other fields are reported.
  pub parcel_diagnostics: Option<ParcelDiagnostics>,
}

/// Diagnostics Parcel reported to the plugin during the current call, such as
/// why [`Asset::content`] failed. Opaque: a [`Diagnostic`] carrying them reports
/// them exactly as Parcel produced them. Parcel ignores them in any later call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParcelDiagnostics(ffi::Diagnostics);

impl Diagnostic {
  /// An error saying `message`. Returning it from a plugin method fails the call.
  pub fn new(message: impl Into<String>) -> Self {
    Diagnostic {
      message: message.into(),
      ..Default::default()
    }
  }

  /// A warning saying `message`. Returning it from a plugin method still fails
  /// the call, with this severity; to warn without failing, pass it to
  /// [`Options::log_diagnostic`] instead.
  pub fn warning(message: impl Into<String>) -> Self {
    Diagnostic {
      message: message.into(),
      severity: DiagnosticSeverity::Warning,
      ..Default::default()
    }
  }

  /// Attaches a source file path for a code frame.
  pub fn with_file(mut self, file_path: impl Into<PathBuf>) -> Self {
    self.file_path = Some(file_path.into());
    self
  }

  /// Sets the 1-based line and column for a code highlight.
  pub fn at(mut self, line: u32, column: u32) -> Self {
    self.line = line;
    self.column = column;
    self
  }

  /// Extends the code highlight to the 1-based line and column of its last
  /// character. Without this, it highlights just the one at [`at`](Self::at).
  pub fn to(mut self, end_line: u32, end_column: u32) -> Self {
    self.end_line = end_line;
    self.end_column = end_column;
    self
  }

  /// Attaches a message shown at the code highlight.
  pub fn with_highlight_message(mut self, message: impl Into<String>) -> Self {
    self.highlight_message = Some(message.into());
    self
  }

  /// Attaches a hint string.
  pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
    self.hint = Some(hint.into());
    self
  }

  /// Attaches a URL to documentation about the diagnostic.
  pub fn with_documentation_url(mut self, url: impl Into<String>) -> Self {
    self.documentation_url = Some(url.into());
    self
  }

  /// Stands for the diagnostics Parcel reported in `diagnostics`, or for a
  /// diagnostic saying `fallback` when Parcel had nothing to report. Its message
  /// is the first diagnostic's.
  fn from_parcel(diagnostics: ffi::Diagnostics, fallback: &str) -> Self {
    if diagnostics == 0 {
      return Diagnostic::new(fallback);
    }
    let mut buf = Buffer::default();
    unsafe { host!(diagnostic_get_message)(&mut buf, diagnostics, 0) };
    Diagnostic {
      parcel_diagnostics: Some(ParcelDiagnostics(diagnostics)),
      ..Diagnostic::new(buf.to_string().unwrap_or_else(|| fallback.to_owned()))
    }
  }

  /// Writes this diagnostic into a host-allocated [`ffi::DiagnosticOptions`], field by
  /// field, leaving its `size` alone.
  /// Intended for use inside macro-generated entry points only.
  ///
  /// # Safety
  ///
  /// `raw` must be NULL or a diagnostic Parcel allocated, or one from `with_sized`.
  pub(crate) unsafe fn write_to_raw(&self, raw: *mut ffi::DiagnosticOptions) {
    if raw.is_null() {
      return;
    }
    if let Some(ParcelDiagnostics(diagnostics)) = self.parcel_diagnostics {
      unsafe { (*raw).diagnostics = diagnostics };
      return;
    }
    unsafe {
      (*raw).message = host!(buffer_alloc)(self.message.as_ptr(), self.message.len());
      (*raw).severity = self.severity;
      if let Some(path) = &self.file_path {
        // Parcel reads it lossily, so a path that is not UTF-8 still points somewhere close.
        let path = path.to_string_lossy();
        (*raw).file_path = host!(buffer_alloc)(path.as_ptr(), path.len());
      }
      (*raw).line = self.line;
      (*raw).column = self.column;
      if let Some(hint) = &self.hint {
        (*raw).hint = host!(buffer_alloc)(hint.as_ptr(), hint.len());
      }
      (*raw).end_line = self.end_line;
      (*raw).end_column = self.end_column;
      if let Some(message) = &self.highlight_message {
        (*raw).highlight_message = host!(buffer_alloc)(message.as_ptr(), message.len());
      }
      if let Some(url) = &self.documentation_url {
        (*raw).documentation_url = host!(buffer_alloc)(url.as_ptr(), url.len());
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
  #[non_exhaustive]
  BuildSuccess {
    bundle_graph: BundleGraph<'a>,
    /// How long the build took.
    build_time: std::time::Duration,
    /// The assets re-transformed by this build. Empty after a full build,
    /// which transformed all of them.
    changed_assets: &'a [AssetIndex],
  },
  #[non_exhaustive]
  BuildFailure { diagnostics: Diagnostics<'a> },
  #[non_exhaustive]
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
  /// `raw` must be the event pointer Parcel supplied, valid for the call, and
  /// `options` the options handle supplied alongside it.
  pub(crate) unsafe fn from_raw(
    raw: *const ffi::ReportEvent,
    options: u64,
  ) -> Option<ReportEvent<'a>> {
    if raw.is_null() {
      return None;
    }
    // Every field here is in the first layout, so none needs a `size` check.
    let event = unsafe {
      read_sized(
        raw,
        std::mem::offset_of!(ffi::ReportEvent, changed_asset_count) + size_of::<usize>(),
      )
    }?;

    let diagnostics = (event.diagnostics != 0).then(|| Diagnostics {
      raw: event.diagnostics,
      lifetime: PhantomData,
    });

    Some(match event.event_type {
      ffi::ReportEventType::BuildStart => ReportEvent::BuildStart,
      ffi::ReportEventType::BuildSuccess => ReportEvent::BuildSuccess {
        bundle_graph: unsafe { BundleGraph::from_raw(event.bundle_graph, options) },
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
      _ => return None,
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

  /// A URL to documentation about the diagnostic, if it has one.
  pub fn documentation_url(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(diagnostic_get_documentation_url)(&mut buf, self.diagnostics.raw, self.index) };
    buf.to_string()
  }

  /// Excerpts of the files the diagnostic is about, with parts of them
  /// highlighted. Empty when it has none.
  pub fn code_frames(&self) -> Vec<CodeFrame> {
    let count = host!(diagnostic_get_code_frame_count);
    let get_frame = host!(diagnostic_get_code_frame);
    let get_highlight = host!(diagnostic_get_code_highlight);
    let raw = self.diagnostics.raw;
    let index = self.index;

    (0..unsafe { count(raw, index) })
      .filter_map(|frame| {
        let (mut code_frame, highlight_count) = with_sized(|info: &mut ffi::CodeFrameInfo| {
          if !unsafe { get_frame(info, raw, index, frame) } {
            return None;
          }
          let code_frame = CodeFrame {
            file_path: info.file_path.to_string(),
            url: info.url.to_string(),
            code: info.code.to_string(),
            language: info.language.to_string(),
            highlights: Vec::new(),
          };
          let highlight_count = info.highlight_count;
          unsafe { ptr::drop_in_place(info) };
          Some((code_frame, highlight_count))
        })?;

        code_frame.highlights = (0..highlight_count)
          .filter_map(|highlight| {
            with_sized(|info: &mut ffi::CodeHighlightInfo| {
              if !unsafe { get_highlight(info, raw, index, frame, highlight) } {
                return None;
              }
              let highlight = CodeHighlight {
                start_line: info.start_line,
                start_column: info.start_column,
                end_line: info.end_line,
                end_column: info.end_column,
                message: info.message.to_string(),
              };
              unsafe { ptr::drop_in_place(info) };
              Some(highlight)
            })
          })
          .collect();
        Some(code_frame)
      })
      .collect()
  }
}

/// An excerpt of a file a diagnostic is about, with parts of it highlighted.
#[non_exhaustive]
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CodeFrame {
  /// The absolute path of the file, when it is one on disk.
  pub file_path: Option<String>,
  /// The URL of the file, e.g. a `file:` URL, when the frame names one.
  pub url: Option<String>,
  /// The code to show, when it differs from the file's contents.
  pub code: Option<String>,
  /// The code's language, as a file extension, when known.
  pub language: Option<String>,
  pub highlights: Vec<CodeHighlight>,
}

/// A highlighted range in a [`CodeFrame`]. Lines and columns are 1-based, and
/// the end is the last highlighted character.
#[non_exhaustive]
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CodeHighlight {
  pub start_line: u32,
  pub start_column: u32,
  pub end_line: u32,
  pub end_column: u32,
  /// A message shown at the highlight.
  pub message: Option<String>,
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

/// Reads an asset's content, as UTF-8 text when `text` is set.
fn read_content(raw: u64, options: u64, text: bool) -> Result<Buffer, Diagnostic> {
  let read = if text {
    host!(asset_get_content_utf8)
  } else {
    host!(asset_get_content)
  };
  let mut buf = Buffer::default();
  let mut diagnostics = 0;
  if unsafe { read(&mut buf, raw, options, &mut diagnostics) } {
    Ok(buf)
  } else {
    Err(Diagnostic::from_parcel(
      diagnostics,
      "Parcel could not read the asset's content",
    ))
  }
}

impl<'a> Asset<'a> {
  /// Wraps the raw Parcel asset handle. Called by [`register_plugin!`].
  ///
  /// # Safety
  ///
  /// `raw` must be the opaque asset pointer supplied by Parcel, and
  /// `options` must be the opaque options handle supplied alongside it.
  pub(crate) unsafe fn from_raw(raw: u64, options: u64) -> Self {
    Asset {
      raw,
      options,
      lifetime: PhantomData,
    }
  }

  // ── Content ──────────────────────────────────────────────────────────────

  /// Reads the asset's content as text. Fails when it cannot be read, or is
  /// not valid UTF-8, with a diagnostic to return as is: `asset.content()?`.
  pub fn content(&self) -> Result<String, Diagnostic> {
    read_content(self.raw, self.options, true).map(|buf| buf.to_string().unwrap_or_default())
  }

  /// Reads the asset's content as bytes. Fails when it cannot be read, with a
  /// diagnostic to return as is.
  pub fn content_bytes(&self) -> Result<Vec<u8>, Diagnostic> {
    read_content(self.raw, self.options, false).map(|buf| buf.to_bytes().unwrap_or_default())
  }

  /// Replaces the asset content with a UTF-8 string.
  pub fn set_content(&mut self, content: impl AsRef<str>) {
    // Parcel trusts content passed to a `_utf8` function, or written with
    // `buffer_write_utf8`, without checking it. Every such call in this SDK is
    // made with the bytes of a `str`, which is always valid UTF-8, and that is
    // what keeps them sound.
    let bytes = content.as_ref().as_bytes();
    unsafe { host!(asset_set_content_utf8)(self.raw, bytes.as_ptr(), bytes.len(), ptr::null(), 0) };
  }

  /// Replaces the asset content with raw bytes.
  pub fn set_content_bytes(&mut self, bytes: &[u8]) {
    unsafe { host!(asset_set_content)(self.raw, bytes.as_ptr(), bytes.len(), ptr::null(), 0) };
  }

  /// Replaces the asset content, along with a JSON (v3) source map describing it.
  ///
  /// The map's `sources` may be absolute paths, `file://` URLs, or paths relative to the asset's
  /// directory. Parcel composes it with the maps of later transformers, so the final bundle maps
  /// back to the files this transformer read.
  pub fn set_content_with_map(&mut self, content: impl AsRef<str>, map: impl AsRef<str>) {
    let content = content.as_ref().as_bytes();
    let map = map.as_ref().as_bytes();
    unsafe {
      host!(asset_set_content_utf8)(
        self.raw,
        content.as_ptr(),
        content.len(),
        map.as_ptr(),
        map.len(),
      )
    };
  }

  /// Replaces the asset content with raw bytes, along with a JSON (v3) source map describing them.
  /// See [`set_content_with_map`](Self::set_content_with_map).
  pub fn set_content_bytes_with_map(&mut self, bytes: &[u8], map: impl AsRef<str>) {
    let map = map.as_ref().as_bytes();
    unsafe {
      host!(asset_set_content)(
        self.raw,
        bytes.as_ptr(),
        bytes.len(),
        map.as_ptr(),
        map.len(),
      )
    };
  }

  /// Returns the JSON (v3) source map describing the current content, or `None` if it has none.
  ///
  /// This is the map an earlier transformer attached (with [`set_content_with_map`] in a native
  /// plugin, or `setCode(code, map)` in a JS one), exactly as it was set: its `sources` may be
  /// absolute paths, `file://` URLs, or paths relative to the asset's directory. Replacing the
  /// content without a map drops it, so a transformer that edits the content should update this map
  /// and pass it back with [`set_content_with_map`] to keep the bundle mapping to the original files.
  ///
  /// [`set_content_with_map`]: Self::set_content_with_map
  pub fn source_map(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_map)(&mut buf, self.raw) };
    buf.to_string()
  }

  pub fn set_custom_content<T: AssetContent>(&mut self, content: T) {
    unsafe extern "C" fn read_content<T: AssetContent>(
      content: *const c_void,
      buf: *mut Buffer,
      diagnostic: *mut ffi::DiagnosticOptions,
    ) {
      let content = unsafe { &(*(content as *const ContentBox<T>)).content };
      if let Some(read) = entry::guard("custom content read", diagnostic, || content.read()) {
        unsafe { write_content(buf, read) };
      }
    }

    unsafe extern "C" fn package_content<T: AssetContent>(
      content: *const c_void,
      bundle_graph: ffi::BundleGraph,
      bundle: ffi::Bundle,
      options: ffi::Options,
      buf: *mut Buffer,
      diagnostic: *mut ffi::DiagnosticOptions,
    ) {
      let content = unsafe { &(*(content as *const ContentBox<T>)).content };
      let bundle_graph = unsafe { BundleGraph::from_raw(bundle_graph, options) };
      let bundle = unsafe { Bundle::from_raw(bundle, options) };
      let options = unsafe { Options::from_raw(options) };
      if let Some(packaged) = entry::guard("custom content package", diagnostic, || {
        content.package(&bundle_graph, &bundle, &options)
      }) {
        unsafe { write_content(buf, packaged) };
      }
    }

    unsafe extern "C" fn free_content<T: AssetContent>(content: *mut c_void) {
      // A panic in the content's `Drop` must not unwind into Parcel, and there
      // is no diagnostic to report it through.
      let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        drop(unsafe { Box::from_raw(content as *mut ContentBox<T>) })
      }));
    }

    /// Writes content the plugin produced into the buffer Parcel passed.
    unsafe fn write_content(buf: *mut Buffer, content: ContentBuffer) {
      match content {
        ContentBuffer::Bytes(bytes) => unsafe {
          host!(buffer_write)(buf, bytes.as_ptr(), bytes.len())
        },
        ContentBuffer::String(string) => unsafe {
          host!(buffer_write_utf8)(buf, string.as_ptr(), string.len())
        },
      }
    }

    let content = Box::leak(Box::new(ContentBox {
      rust_type: rust_type_witness::<T>(),
      content,
    }));
    unsafe {
      host!(asset_set_custom_content)(
        self.raw,
        &T::TYPE_ID,
        content as *mut ContentBox<T> as *mut c_void,
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
        if ty != T::TYPE_ID {
          return None;
        }
        return downcast_content::<T>(content);
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
  pub fn file_path(&self) -> PathBuf {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_file_path)(&mut buf, self.raw, self.options) };
    PathBuf::from(buf.to_string().unwrap_or_default())
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
  ///
  /// Fails when Parcel cannot honor `dep`, e.g. because it uses a
  /// [`SpecifierType`], [`Priority`], [`BundleBehavior`], or [`ImportType`]
  /// value this version of Parcel does not support.
  pub fn add_dependency(&mut self, dep: DependencyOptions) -> Result<(), Diagnostic> {
    let added = dep.with_raw(|raw| unsafe { host!(asset_add_dependency)(self.raw, raw) });
    if added {
      Ok(())
    } else {
      Err(Diagnostic::new(format!(
        "Parcel could not add the dependency {:?}: it uses an option this version of Parcel does not support.",
        dep.specifier
      )))
    }
  }

  /// Resolves `dep` with the configured resolver plugins, exactly as if it had been added with
  /// [`add_dependency`](Self::add_dependency), without adding it.
  ///
  /// `from` is the absolute path of the file containing the import, when that is not the asset
  /// itself, e.g. a Sass partial the asset pulled in. Every file the resolvers read or probe
  /// invalidates the asset, so the transform re-runs when the result would change.
  ///
  /// Returns [`ResolveResult::None`] when no resolver claimed the dependency, and fails when one
  /// failed, or Parcel cannot honor `dep`. Only available while transforming.
  pub fn resolve(
    &self,
    dep: &DependencyOptions,
    from: Option<&Path>,
  ) -> Result<ResolveResult, Diagnostic> {
    let failed = || Diagnostic::new(format!("Could not resolve {:?}", dep.specifier));
    let from = match from {
      Some(from) => path_arg(from).map_err(|_| failed())?,
      None => "",
    };
    with_sized(|result: &mut ffi::ResolveResult| {
      let resolved = dep.with_raw(|raw| unsafe {
        host!(asset_resolve)(
          self.raw,
          self.options,
          raw,
          from.as_ptr(),
          from.len(),
          result,
        )
      });
      // Dropping the buffers frees them.
      let file_path = std::mem::take(&mut result.file_path);
      let pipeline = std::mem::take(&mut result.pipeline);
      if !resolved {
        return Err(failed());
      }

      Ok(match result.resolution_type {
        ffi::ResolutionType::FilePath => ResolveResult::Resolved {
          file_path: PathBuf::from(file_path.to_string().ok_or_else(failed)?),
          pipeline: pipeline.to_string(),
        },
        ffi::ResolutionType::External => ResolveResult::External,
        ffi::ResolutionType::Excluded => ResolveResult::Excluded,
        ffi::ResolutionType::None => ResolveResult::None,
        // A kind of resolution this SDK predates, which a plugin cannot act on.
        _ => return Err(failed()),
      })
    })
  }

  // ── Symbols ───────────────────────────────────────────────────────────────

  /// Registers an exported symbol name (e.g. `"default"`, `"foo"`, `"*"`).
  pub fn add_export_symbol(&mut self, name: &str) {
    let b = name.as_bytes();
    unsafe { host!(asset_add_export_symbol)(self.raw, b.as_ptr(), b.len()) };
  }
}

/// Custom content is boxed together with a witness of its concrete Rust type
/// so `custom_content` can verify it before casting. The stable
/// [`AssetContent::TYPE_ID`] is not proof of layout, since another copy of a
/// plugin (e.g. a different version loaded as a separate library) can use the
/// same id for a type that has changed; `TypeId` bytes only match within one
/// compiled copy, which is exactly the guarantee the cast needs.
///
/// `repr(C)` keeps the witness at offset 0 in every SDK build. Reading it from
/// a pointer another SDK copy created is sound because a [`TYPE_ID`] match
/// implies that copy used this same header: the `parcel.content.v1` namespace
/// in [`type_id!`] versions this layout — change it, bump the namespace.
#[repr(C)]
struct ContentBox<T> {
  rust_type: [u8; 16],
  content: T,
}

fn rust_type_witness<T: 'static>() -> [u8; 16] {
  // TypeId's layout is unspecified; a size change fails this transmute at
  // compile time — handle that (and bump the id namespace) if it ever happens.
  unsafe { std::mem::transmute(TypeId::of::<T>()) }
}

/// Downcasts a custom content pointer to `T` after verifying its witness.
///
/// # Safety
/// `content` must be non-null and point to a live `ContentBox` whose
/// [`AssetContent::TYPE_ID`] matched `T`'s.
unsafe fn downcast_content<'a, T: AssetContent>(content: *const c_void) -> Option<&'a T> {
  // Read only the header: the pointee may be a ContentBox<U> smaller than
  // ContentBox<T>, so no ContentBox<T> place may be formed before the witness
  // matches.
  let witness = unsafe { (content as *const [u8; 16]).read() };
  if witness != rust_type_witness::<T>() {
    return None;
  }
  Some(unsafe { &(*(content as *const ContentBox<T>)).content })
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
///
/// Non-exhaustive: build one with [`new`](Self::new) or from a [`ContentBuffer`].
#[non_exhaustive]
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

/// Builds a stable content type id by prefixing the plugin crate's package name.
#[macro_export]
macro_rules! type_id {
  ($name:literal) => {
    $crate::content_type_id(concat!(
      "parcel.content.v1\0",
      env!("CARGO_PKG_NAME"),
      "\0",
      $name
    ))
  };
}

/// Derives the stable 16-byte content type id for an [`AssetContent::TYPE_ID`].
pub const fn content_type_id(name: &str) -> [u8; 16] {
  let digest = sha2_const_stable::Sha256::new()
    .update(name.as_bytes())
    .finalize();
  let mut id = [0u8; 16];
  let mut i = 0;
  while i < 16 {
    id[i] = digest[i];
    i += 1;
  }
  id
}

pub trait AssetContent: Send + Sync + 'static {
  /// Globally unique, stable id for this content type.
  ///
  /// ```rust,ignore
  /// const TYPE_ID: [u8; 16] = parcel_plugin::type_id!("MyContent");
  /// ```
  const TYPE_ID: [u8; 16];

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
  pub(crate) unsafe fn from_raw(raw: ffi::BundleGraph, options: ffi::Options) -> Self {
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

  /// The resolution of one of `asset`'s dependencies. [`Invalid`] for an index
  /// out of range, and for a kind of resolution this SDK predates.
  ///
  /// [`Invalid`]: BundleGraphDependencyResolution::Invalid
  pub fn dependency_resolution(
    &self,
    asset: AssetIndex,
    dependency_index: usize,
  ) -> BundleGraphDependencyResolution {
    let resolution = with_sized(|resolution: &mut ffi::BundleGraphDependencyResolution| {
      unsafe {
        host!(bundle_graph_get_dependency_resolution)(resolution, self.raw, asset, dependency_index)
      };
      *resolution
    });
    match resolution.resolution_type {
      ffi::BundleGraphResolutionType::None => BundleGraphDependencyResolution::None,
      ffi::BundleGraphResolutionType::Deferred => BundleGraphDependencyResolution::Deferred,
      ffi::BundleGraphResolutionType::External => BundleGraphDependencyResolution::External,
      ffi::BundleGraphResolutionType::Excluded => BundleGraphDependencyResolution::Excluded,
      ffi::BundleGraphResolutionType::Asset => {
        BundleGraphDependencyResolution::Asset(resolution.asset)
      }
      ffi::BundleGraphResolutionType::Bundle => BundleGraphDependencyResolution::Bundle {
        bundle_index: resolution.bundle,
        asset_index: resolution.asset,
      },
      ffi::BundleGraphResolutionType::Internalized => {
        BundleGraphDependencyResolution::Internalized(resolution.asset)
      }
      _ => BundleGraphDependencyResolution::Invalid,
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

  /// Reads the asset's content as text. See [`Asset::content`].
  pub fn content(&self) -> Result<String, Diagnostic> {
    read_content(self.raw, self.options, true).map(|buf| buf.to_string().unwrap_or_default())
  }

  /// Reads the asset's content as bytes. See [`Asset::content_bytes`].
  pub fn content_bytes(&self) -> Result<Vec<u8>, Diagnostic> {
    read_content(self.raw, self.options, false).map(|buf| buf.to_bytes().unwrap_or_default())
  }

  pub fn custom_content<T: AssetContent>(&self) -> Option<&'a T> {
    let mut ty = [0; 16];
    let mut content = std::ptr::null_mut();
    unsafe {
      if !host!(asset_get_custom_content)(&mut ty, &mut content, self.raw) {
        return None;
      }
      if !content.is_null() {
        if ty != T::TYPE_ID {
          return None;
        }
        return downcast_content::<T>(content);
      }
    }

    None
  }

  pub fn asset_type(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_type)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
  }

  pub fn file_path(&self) -> PathBuf {
    let mut buf = Buffer::default();
    unsafe { host!(asset_get_file_path)(&mut buf, self.raw, self.options) };
    PathBuf::from(buf.to_string().unwrap_or_default())
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

/// What a dependency resolved to in the bundle graph.
///
/// Non-exhaustive, as is [`Bundle`](Self::Bundle): match with a catch-all, so a
/// plugin keeps working when Parcel adds a kind of resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BundleGraphDependencyResolution {
  Invalid,
  None,
  Deferred,
  External,
  Excluded,
  Asset(AssetIndex),
  #[non_exhaustive]
  Bundle {
    bundle_index: BundleIndex,
    asset_index: AssetIndex,
  },
  Internalized(AssetIndex),
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
  pub(crate) unsafe fn from_raw(raw: ffi::Bundle, options: ffi::Options) -> Self {
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

  pub fn dist_path(&self) -> Option<PathBuf> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_dist_path)(&mut buf, self.raw) };
    buf.to_string().map(PathBuf::from)
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

  /// A dist-relative name that doesn't change with the bundle's content. Runtimes resolve it to the
  /// final name through a manifest, so accessing it is not a bundle dependency.
  pub fn stable_key(&self) -> Option<String> {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_stable_key)(&mut buf, self.raw) };
    buf.to_string()
  }

  /// The string a namer must include exactly once in the file name of a bundle that may be
  /// content hashed.
  pub fn hash_reference(&self) -> String {
    let mut buf = Buffer::default();
    unsafe { host!(bundle_get_hash_reference)(&mut buf, self.raw) };
    buf.to_string().unwrap_or_default()
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
  pub fn dist_dir(&self) -> PathBuf {
    let mut buf = Buffer::default();
    unsafe { host!(target_get_dist_dir)(&mut buf, self.raw, self.options) };
    PathBuf::from(buf.to_string().unwrap_or_default())
  }
}

// ── Dependency ─────────────────────────────────────────────────────────────

/// Read-only view of a Parcel dependency.
///
/// Passed to [`Plugin::resolve`] and returned by [`AssetRef::dependency`].
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
  pub(crate) unsafe fn from_raw(raw: u64, options: u64) -> Self {
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

  /// Returns the absolute path of the file that contains this import, if it
  /// came from one.
  pub fn source_path(&self) -> Option<PathBuf> {
    let mut buf = Buffer::default();
    unsafe { host!(dep_get_source_path)(&mut buf, self.raw, self.options) };
    buf.to_string().map(PathBuf::from)
  }

  /// Returns the path to resolve the specifier from: the one set explicitly,
  /// or else the file that contains the import.
  pub fn resolve_from(&self) -> Option<PathBuf> {
    let mut buf = Buffer::default();
    unsafe { host!(dep_get_resolve_from)(&mut buf, self.raw, self.options) };
    buf.to_string().map(PathBuf::from)
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
///
/// Non-exhaustive, as is [`Resolved`](Self::Resolved): match with a catch-all,
/// and build one with [`ResolveResult::file`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ResolveResult {
  /// Not resolved: continue to the next resolver.
  #[default]
  None,
  /// Resolve to an absolute file path, optionally using a transformer pipeline.
  #[non_exhaustive]
  Resolved {
    file_path: PathBuf,
    pipeline: Option<String>,
  },
  /// Treat the dependency as external (not bundled).
  External,
  /// Exclude the dependency from the bundle.
  Excluded,
}

impl ResolveResult {
  /// Resolves to the file at the absolute `path`.
  pub fn file(path: impl Into<PathBuf>) -> Self {
    ResolveResult::Resolved {
      file_path: path.into(),
      pipeline: None,
    }
  }

  /// Transforms the resolved file with the named `pipeline`. Only meaningful for
  /// a file; any other result is returned unchanged.
  pub fn with_pipeline(mut self, name: impl Into<String>) -> Self {
    if let ResolveResult::Resolved { pipeline, .. } = &mut self {
      *pipeline = Some(name.into());
    }
    self
  }

  /// Writes this result into the [`ffi::ResolveResult`] Parcel allocated, field
  /// by field, leaving its `size` alone. Fails for a path Parcel cannot
  /// represent.
  ///
  /// # Safety
  ///
  /// `raw` must be the zeroed result Parcel passed to `parcel_plugin_resolve`.
  pub(crate) unsafe fn write_to_raw(self, raw: *mut ffi::ResolveResult) -> Result<(), Diagnostic> {
    // Through field places rather than a `&mut` to the whole struct, which would
    // claim more than Parcel allocated once this SDK's struct outgrows it.
    unsafe {
      match self {
        ResolveResult::None => (*raw).resolution_type = ffi::ResolutionType::None,
        ResolveResult::Resolved {
          file_path,
          pipeline,
        } => {
          let Some((bytes, is_utf8)) = resolved_path_bytes(&file_path) else {
            return Err(Diagnostic::new(format!(
              "Resolved to {}, which is not valid UTF-8",
              file_path.display()
            )));
          };
          (*raw).resolution_type = ffi::ResolutionType::FilePath;
          let write = if is_utf8 {
            host!(buffer_write_utf8)
          } else {
            host!(buffer_write)
          };
          write(&mut (*raw).file_path, bytes.as_ptr(), bytes.len());
          if let Some(pipeline) = pipeline {
            host!(buffer_write_utf8)(&mut (*raw).pipeline, pipeline.as_ptr(), pipeline.len());
          }
        }
        ResolveResult::External => (*raw).resolution_type = ffi::ResolutionType::External,
        ResolveResult::Excluded => (*raw).resolution_type = ffi::ResolutionType::Excluded,
      }
    }
    Ok(())
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
/// # Threading
///
/// Parcel calls one instance from many threads at once: transforms and resolves
/// run in parallel, as do optimizers, and log events reach [`report`] on
/// whichever thread logged them. That is why the trait requires `Send + Sync`;
/// keep any state that changes behind a `Mutex` or in atomics.
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
///         asset.set_content(format!("{}: {}", self.prefix, asset.content()?));
///         Ok(())
///     }
/// }
///
/// register_plugin!(MyPlugin);
/// ```
pub trait Plugin: Sized + Send + Sync {
  /// Called once for each `.parcelrc` entry naming the plugin, which may name it
  /// more than once with different configs, before any other method. `config`
  /// is that entry's config as UTF-8 JSON (empty when it has none).
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
/// per-entry state pointer, and `parcel_plugin_deinit` drops the box. The other
/// five borrow it as `&MyPlugin` and call the corresponding trait method. Each
/// catches panics, reporting them as diagnostics rather than unwinding into
/// Parcel.
#[macro_export]
macro_rules! register_plugin {
  ($type:ty) => {
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_init(
      api: *const ::core::ffi::c_void,
      config: *const u8,
      config_len: usize,
      state: *mut *mut ::core::ffi::c_void,
      diagnostic: *mut ::core::ffi::c_void,
    ) -> u8 {
      unsafe { $crate::__private::init::<$type>(api, config, config_len, state, diagnostic) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_deinit(state: *mut ::core::ffi::c_void) {
      unsafe { $crate::__private::deinit::<$type>(state) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_transform(
      asset: u64,
      options: u64,
      state: *mut ::core::ffi::c_void,
      diagnostic: *mut ::core::ffi::c_void,
    ) {
      unsafe { $crate::__private::transform::<$type>(asset, options, state, diagnostic) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_resolve(
      dependency: u64,
      specifier: *const u8,
      specifier_len: usize,
      pipeline: *const u8,
      pipeline_len: usize,
      options: u64,
      result: *mut ::core::ffi::c_void,
      state: *mut ::core::ffi::c_void,
      diagnostic: *mut ::core::ffi::c_void,
    ) {
      unsafe {
        $crate::__private::resolve::<$type>(
          dependency,
          specifier,
          specifier_len,
          pipeline,
          pipeline_len,
          options,
          result,
          state,
          diagnostic,
        )
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_name(
      bundle_graph: u64,
      bundle: u64,
      options: u64,
      name: *mut ::core::ffi::c_void,
      state: *mut ::core::ffi::c_void,
      diagnostic: *mut ::core::ffi::c_void,
    ) {
      unsafe {
        $crate::__private::name::<$type>(bundle_graph, bundle, options, name, state, diagnostic)
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_optimize(
      bundle_graph: u64,
      bundle: u64,
      contents: *const u8,
      contents_len: usize,
      source_map: *const u8,
      source_map_len: usize,
      options: u64,
      result: *mut ::core::ffi::c_void,
      state: *mut ::core::ffi::c_void,
      diagnostic: *mut ::core::ffi::c_void,
    ) {
      unsafe {
        $crate::__private::optimize::<$type>(
          bundle_graph,
          bundle,
          contents,
          contents_len,
          source_map,
          source_map_len,
          options,
          result,
          state,
          diagnostic,
        )
      }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn parcel_plugin_report(
      event: *const ::core::ffi::c_void,
      options: u64,
      state: *mut ::core::ffi::c_void,
      diagnostic: *mut ::core::ffi::c_void,
    ) {
      unsafe { $crate::__private::report::<$type>(event, options, state, diagnostic) }
    }
  };
}

/// What [`register_plugin!`] expands to calls. Not part of the SDK's API.
#[doc(hidden)]
pub mod __private {
  pub use crate::entry::*;
}

#[cfg(test)]
mod tests {
  use super::*;

  struct TestContent;

  impl AssetContent for TestContent {
    const TYPE_ID: [u8; 16] = type_id!("TestContent");

    fn read(&self) -> Result<ContentBuffer, Diagnostic> {
      Ok(ContentBuffer::Bytes(Vec::new()))
    }

    fn package(
      &self,
      _bundle_graph: &BundleGraph,
      _bundle: &Bundle,
      _options: &Options,
    ) -> Result<ContentBuffer, Diagnostic> {
      Ok(ContentBuffer::Bytes(Vec::new()))
    }
  }

  #[test]
  fn flags_set_and_clear() {
    let mut flags = AssetFlags::empty();
    assert!(flags.is_empty());
    assert_eq!(flags, AssetFlags::default());

    flags.insert(AssetFlags::IS_SOURCE | AssetFlags::SIDE_EFFECTS);
    assert!(flags.contains(AssetFlags::IS_SOURCE | AssetFlags::SIDE_EFFECTS));

    flags.remove(AssetFlags::SIDE_EFFECTS);
    assert!(flags.contains(AssetFlags::IS_SOURCE));
    assert!(!flags.contains(AssetFlags::SIDE_EFFECTS));

    flags.set(AssetFlags::IS_ESM, true);
    flags.set(AssetFlags::IS_SOURCE, false);
    assert_eq!(flags, AssetFlags::IS_ESM);
    assert!(!(!AssetFlags::IS_ESM).contains(AssetFlags::IS_ESM));
  }

  #[test]
  fn builders_set_what_they_name() {
    let dep = DependencyOptions::new("./a.css")
      .priority(Priority::Lazy)
      .conditions(ExportsConditions::SASS)
      .conditions(ExportsConditions::STYLE)
      .import_type(ImportType::StyleSheet);
    assert_eq!(dep.specifier, "./a.css");
    assert_eq!(dep.priority, Priority::Lazy);
    assert!(
      dep
        .conditions
        .contains(ExportsConditions::SASS | ExportsConditions::STYLE)
    );
    assert_eq!(dep.import_type, ImportType::StyleSheet);

    assert_eq!(
      ResolveResult::file("/a.js").with_pipeline("url"),
      ResolveResult::Resolved {
        file_path: "/a.js".into(),
        pipeline: Some("url".into()),
      }
    );
    // Only a file has a pipeline.
    assert_eq!(
      ResolveResult::External.with_pipeline("url"),
      ResolveResult::External
    );
  }

  #[test]
  fn content_type_id_derivation_is_stable() {
    // Golden value. If this assertion ever fails, the id derivation changed,
    // which invalidates every user's cache and changes their bundle ids.
    assert_eq!(
      TestContent::TYPE_ID,
      [
        0xd8, 0x71, 0x00, 0x6b, 0x60, 0x16, 0x0e, 0x55, 0xaf, 0xdc, 0xbb, 0x06, 0x0b, 0x0d, 0xb0,
        0xd2,
      ]
    );
  }
}
