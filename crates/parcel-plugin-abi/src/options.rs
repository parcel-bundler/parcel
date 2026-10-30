//! Read-only Parcel option accessors.

use std::{borrow::Cow, sync::Mutex};

use parcel_core::{
  Diagnostic as CoreDiagnostic, DiagnosticSeverity as CoreDiagnosticSeverity, FileSystem,
  LogLevel as CoreLogLevel, ParcelOptions, PluginContext,
};

use crate::{
  Buffer, DiagnosticOptions, Diagnostics, LogLevel, LogLevelFFI, Options, copy_plugin_cdiagnostic,
  diagnostics::DiagnosticsView, plugin_bytes, plugin_str, write_buffer,
};

/// What an [`Options`] handle points to.
///
/// The handle is opaque to plugins, so it can carry more than the options
/// themselves. During a transform or a resolve it also carries the
/// [`PluginContext`]: the file system that records every path a plugin reads as
/// an invalidation, and the resolver chain `parcel_asset_resolve` runs. Elsewhere
/// it is `None`, and those functions report an error rather than read files
/// nothing would ever invalidate.
///
/// It also owns the [`Diagnostics`] lists Parcel hands the plugin during the
/// call, so that they live exactly as long as the call and the plugin never has
/// to free one.
///
/// Lives on the host's stack for the duration of the plugin call that receives
/// the handle, exactly as the bare options pointer did.
/// cbindgen:ignore
pub(crate) struct OptionsContext<'a> {
  pub options: &'a ParcelOptions,
  pub plugin: Option<&'a PluginContext<'a>>,
  /// Boxed, so a handle stays valid as more are added. Behind a mutex because a
  /// plugin may call into Parcel from several threads during one call.
  diagnostics: Mutex<Vec<Box<DiagnosticsView<'static>>>>,
}

impl<'a> OptionsContext<'a> {
  /// For entry points with no plugin context: namers, optimizers, reporters, packagers.
  pub fn new(options: &'a ParcelOptions) -> Self {
    OptionsContext {
      options,
      plugin: None,
      diagnostics: Mutex::default(),
    }
  }

  /// For transforms and resolves.
  pub fn with_plugin(plugin: &'a PluginContext<'a>) -> Self {
    OptionsContext {
      options: plugin.options,
      plugin: Some(plugin),
      diagnostics: Mutex::default(),
    }
  }

  /// Hands the plugin `diagnostics` as a list that lives until this call returns.
  #[allow(dead_code)]
  pub fn hand_out(&self, diagnostics: Vec<CoreDiagnostic>) -> Diagnostics {
    let view = Box::new(DiagnosticsView {
      diagnostics: Cow::Owned(diagnostics),
    });
    let handle = &*view as *const DiagnosticsView as Diagnostics;
    self.diagnostics.lock().unwrap().push(view);
    handle
  }

  /// The diagnostics in `handle`, if it is a list this call handed out. Any other
  /// handle, including one from an earlier call, is ignored: it may be freed.
  pub fn call_diagnostics(&self, handle: Diagnostics) -> Option<Vec<CoreDiagnostic>> {
    if handle == 0 {
      return None;
    }
    let lists = self.diagnostics.lock().unwrap();
    let view = lists
      .iter()
      .find(|view| &***view as *const DiagnosticsView as Diagnostics == handle)?;
    Some(view.diagnostics.to_vec())
  }

  pub fn fs(&self) -> Option<&'a dyn FileSystem> {
    self.plugin.map(|plugin| &**plugin.fs)
  }

  pub fn handle(&self) -> Options {
    self as *const OptionsContext as Options
  }
}

/// # Safety
///
/// `options` must be a handle created by [`OptionsContext::handle`] whose
/// context is still alive.
pub(crate) unsafe fn options_context<'a>(options: Options) -> &'a OptionsContext<'a> {
  unsafe { &*(options as *const OptionsContext) }
}

// ── Options accessors (read-only) ─────────────────────────────────────────────

/// Returns the project root as an absolute filesystem path into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_options_get_project_root(buf: *mut Buffer, options: Options) {
  if buf.is_null() || options == 0 {
    return;
  }
  let options = unsafe { options_context(options) }.options;
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
pub extern "C" fn parcel_options_get_env(
  buf: *mut Buffer,
  options: Options,
  key: *const u8,
  key_len: usize,
) {
  if buf.is_null() || options == 0 || key.is_null() {
    return;
  }
  let options = unsafe { options_context(options) }.options;
  let Some(key) = (unsafe { plugin_str(key, key_len) }) else {
    return;
  };
  if let Some(value) = options.env.get(key) {
    unsafe { write_buffer(buf, value.as_bytes().to_vec(), true) };
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

/// Logs a message to the build's reporters.
///
/// Available from every plugin entry point, since they all receive `options`.
/// The message is dropped when the build has no reporters, or when `level` is
/// below the build's configured log level. A `level` this version of Parcel does
/// not know is logged as `PARCEL_LOG_INFO`.
pub extern "C" fn parcel_options_log(
  options: Options,
  level: LogLevelFFI,
  message: *const u8,
  message_len: usize,
) {
  if options == 0 || message.is_null() {
    return;
  }
  let options = unsafe { options_context(options) }.options;
  // Lossy rather than dropped: a message with a stray invalid byte is still worth seeing.
  let message = String::from_utf8_lossy(unsafe { plugin_bytes(message, message_len) });
  let level = LogLevel::try_from(level).unwrap_or(LogLevel::PARCEL_LOG_INFO);
  options.log(CoreLogLevel::from(level), &message);
}

/// Logs a diagnostic to the build's reporters without failing the build — the
/// way a plugin raises a warning, as opposed to writing to the `DiagnosticOptions`
/// out-param, which ends the build.
///
/// Logs the diagnostic `diagnostic` describes, if it has a message, then those of
/// its `diagnostics` list, if this call handed it out. Each is logged at the level
/// of its own severity, so the two cannot contradict each other. The host copies
/// what it needs: the plugin still owns the buffers and should free them as
/// usual. Dropped when the diagnostic's `size` is unset.
pub extern "C" fn parcel_options_log_diagnostic(
  options: Options,
  diagnostic: *const DiagnosticOptions,
) {
  if options == 0 || diagnostic.is_null() {
    return;
  }
  let context = unsafe { options_context(options) };
  for diagnostic in unsafe { copy_plugin_cdiagnostic(diagnostic, Some(context)) } {
    let level = match diagnostic.severity {
      CoreDiagnosticSeverity::Error | CoreDiagnosticSeverity::SourceError => CoreLogLevel::Error,
      CoreDiagnosticSeverity::Warning => CoreLogLevel::Warn,
      CoreDiagnosticSeverity::Info => CoreLogLevel::Info,
    };
    context.options.log_diagnostic(level, diagnostic);
  }
}
