//! Read-only access to the diagnostics carried by a reporter event.
//!
//! A [`Diagnostics`] handle is valid only for the duration of the
//! `parcel_plugin_report()` call it was passed to.
//!
//! Out-of-range indices are not an error: a getter writes nothing, and a count
//! returns 0. A reporter walking a list it did not build should not have to
//! bounds-check every call to avoid taking the build down.

use parcel_core::Diagnostic as CoreDiagnostic;

use crate::{Buffer, DiagnosticSeverity, Diagnostics, write_buffer};

/// What a [`Diagnostics`] handle points to. Host-side only — a plugin sees the
/// opaque `u64`, which is why this is not part of the generated header.
pub(crate) struct DiagnosticsView<'a> {
  pub(crate) diagnostics: &'a [CoreDiagnostic],
}

fn diagnostic<'a>(diagnostics: Diagnostics, index: usize) -> Option<&'a CoreDiagnostic> {
  if diagnostics == 0 {
    return None;
  }
  let view: &DiagnosticsView<'_> = unsafe { &*(diagnostics as *const DiagnosticsView) };
  view.diagnostics.get(index)
}

/// Returns how many diagnostics the event carries. 0 when it carries none.
pub extern "C" fn parcel_diagnostics_get_count(diagnostics: Diagnostics) -> usize {
  if diagnostics == 0 {
    return 0;
  }
  let view: &DiagnosticsView<'_> = unsafe { &*(diagnostics as *const DiagnosticsView) };
  view.diagnostics.len()
}

/// Returns the diagnostic's message into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_diagnostic_get_message(
  buf: *mut Buffer,
  diagnostics: Diagnostics,
  index: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(diagnostic) = diagnostic(diagnostics, index) {
    unsafe { write_buffer(buf, diagnostic.message.as_bytes().to_vec(), true) };
  }
}

/// Returns the diagnostic's severity (`PARCEL_SEVERITY_*`), or
/// `PARCEL_SEVERITY_ERROR` when `index` is out of range.
pub extern "C" fn parcel_diagnostic_get_severity(
  diagnostics: Diagnostics,
  index: usize,
) -> DiagnosticSeverity {
  diagnostic(diagnostics, index).map_or(DiagnosticSeverity::PARCEL_SEVERITY_ERROR, |diagnostic| {
    DiagnosticSeverity::from(diagnostic.severity.clone())
  })
}

/// Returns the name of the plugin the diagnostic came from into `*buf`, if it
/// recorded one. Leaves `buf->data == NULL` when it did not.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
pub extern "C" fn parcel_diagnostic_get_origin(
  buf: *mut Buffer,
  diagnostics: Diagnostics,
  index: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(origin) = diagnostic(diagnostics, index).and_then(|d| d.origin.as_ref()) {
    unsafe { write_buffer(buf, origin.as_bytes().to_vec(), true) };
  }
}

/// Returns how many hints the diagnostic has.
pub extern "C" fn parcel_diagnostic_get_hint_count(
  diagnostics: Diagnostics,
  index: usize,
) -> usize {
  diagnostic(diagnostics, index).map_or(0, |diagnostic| diagnostic.hints.len())
}

/// Returns one of the diagnostic's hints into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_diagnostic_get_hint(
  buf: *mut Buffer,
  diagnostics: Diagnostics,
  index: usize,
  hint: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(hint) = diagnostic(diagnostics, index).and_then(|d| d.hints.get(hint)) {
    unsafe { write_buffer(buf, hint.as_bytes().to_vec(), true) };
  }
}
