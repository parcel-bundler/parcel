//! Read-only Parcel option accessors.

use parcel_core::{LogLevel as CoreLogLevel, ParcelOptions};

use crate::{Buffer, Diagnostic, LogLevel, Options, bytes_to_str, copy_cdiagnostic, write_buffer};

// ── Options accessors (read-only) ─────────────────────────────────────────────

/// Returns the project root as an absolute filesystem path into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
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

// ── Logging ───────────────────────────────────────────────────────────────────

/// Logs a message to the build's reporters.
///
/// Available from every plugin entry point, since they all receive `options`.
/// The message is dropped when the build has no reporters, or when `level` is
/// below the build's configured log level.
pub extern "C" fn parcel_options_log(
  options: Options,
  level: LogLevel,
  message: *const u8,
  message_len: usize,
) {
  if options == 0 || message.is_null() {
    return;
  }
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let message = unsafe { bytes_to_str(message, message_len) };
  options.log(CoreLogLevel::from(level), message);
}

/// Logs a diagnostic to the build's reporters without failing the build — the
/// way a plugin raises a warning, as opposed to writing to the `Diagnostic`
/// out-param, which ends the build.
///
/// The log level comes from the diagnostic's own severity, so the two cannot
/// contradict each other. The host copies what it needs: the plugin still owns
/// the buffers and should free them as usual.
pub extern "C" fn parcel_options_log_diagnostic(options: Options, diagnostic: *const Diagnostic) {
  if options == 0 || diagnostic.is_null() {
    return;
  }
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let diagnostic = unsafe { &*diagnostic };
  let level = match diagnostic.severity {
    crate::DiagnosticSeverity::PARCEL_SEVERITY_ERROR => CoreLogLevel::Error,
    crate::DiagnosticSeverity::PARCEL_SEVERITY_SOURCE_ERROR => CoreLogLevel::Error,
    crate::DiagnosticSeverity::PARCEL_SEVERITY_WARNING => CoreLogLevel::Warn,
    crate::DiagnosticSeverity::PARCEL_SEVERITY_INFO => CoreLogLevel::Info,
  };

  if let Some(diagnostic) = copy_cdiagnostic(diagnostic, Some(&options.project_root)) {
    options.log_diagnostic(level, diagnostic);
  }
}
