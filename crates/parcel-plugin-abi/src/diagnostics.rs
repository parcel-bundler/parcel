//! Read-only access to lists of diagnostics: those a reporter event carries, and
//! those Parcel hands a plugin during a call, such as a failed read's.
//!
//! A [`DiagnosticsRef`] handle is valid only for the duration of the call it was
//! passed to or obtained in.
//!
//! Out-of-range indices are not an error: a getter writes nothing, and a count
//! returns 0. A reporter walking a list it did not build should not have to
//! bounds-check every call to avoid taking the build down.

use std::borrow::Cow;

use parcel_core::Diagnostic as CoreDiagnostic;

use crate::{
  Buffer, DiagnosticSeverity, DiagnosticsRef,
  extensible::{Extensible, write_extensible},
  parcel_free_buffer, write_buffer,
};

/// What a [`DiagnosticsRef`] handle points to: a reporter event's diagnostics,
/// borrowed, or a list owned by the call that handed it out. Host-side only — a
/// plugin sees the opaque `u64`, which is why this is not part of the generated
/// header.
pub(crate) struct DiagnosticsView<'a> {
  pub(crate) diagnostics: Cow<'a, [CoreDiagnostic]>,
}

fn diagnostic<'a>(diagnostics: DiagnosticsRef, index: usize) -> Option<&'a CoreDiagnostic> {
  if diagnostics == 0 {
    return None;
  }
  let view: &DiagnosticsView<'_> = unsafe { &*(diagnostics as *const DiagnosticsView) };
  view.diagnostics.get(index)
}

fn code_frame<'a>(
  diagnostics: DiagnosticsRef,
  index: usize,
  frame: usize,
) -> Option<&'a parcel_core::CodeFrame> {
  diagnostic(diagnostics, index)?.code_frames.get(frame)
}

/// Returns how many diagnostics the list holds. 0 when it holds none.
pub extern "C" fn parcel_diagnostics_get_count(diagnostics: DiagnosticsRef) -> usize {
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
  diagnostics: DiagnosticsRef,
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
  diagnostics: DiagnosticsRef,
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
  diagnostics: DiagnosticsRef,
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
  diagnostics: DiagnosticsRef,
  index: usize,
) -> usize {
  diagnostic(diagnostics, index).map_or(0, |diagnostic| diagnostic.hints.len())
}

/// Returns one of the diagnostic's hints into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
pub extern "C" fn parcel_diagnostic_get_hint(
  buf: *mut Buffer,
  diagnostics: DiagnosticsRef,
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

/// Returns the URL of documentation about the diagnostic into `*buf`, or leaves
/// `buf->data == NULL` when it has none.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
pub extern "C" fn parcel_diagnostic_get_documentation_url(
  buf: *mut Buffer,
  diagnostics: DiagnosticsRef,
  index: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(url) = diagnostic(diagnostics, index).and_then(|d| d.documentation_url.as_ref()) {
    unsafe { write_buffer(buf, url.as_bytes().to_vec(), true) };
  }
}

/// Returns how many code frames the diagnostic has: excerpts of the files it is
/// about, with parts of them highlighted.
pub extern "C" fn parcel_diagnostic_get_code_frame_count(
  diagnostics: DiagnosticsRef,
  index: usize,
) -> usize {
  diagnostic(diagnostics, index).map_or(0, |diagnostic| diagnostic.code_frames.len())
}

/// One of a diagnostic's code frames, filled in by
/// `parcel_diagnostic_get_code_frame()`.
///
/// Set `size` before the call, as `CodeFrameInfo info = {.size = sizeof(CodeFrameInfo)};`;
/// Parcel writes only the fields that fit. Free each buffer after.
#[repr(C)]
pub struct CodeFrameInfo {
  /// `sizeof(CodeFrameInfo)` as the caller was built. Always the first member.
  pub size: usize,
  /// The absolute path of the file, when the frame is about one on disk.
  pub file_path: Buffer,
  /// The URL of the file, e.g. a `file:` URL, when the frame names one.
  pub url: Buffer,
  /// The code to show, when it differs from the file's contents. Empty to read the file.
  pub code: Buffer,
  /// The code's language, as a file extension, for syntax highlighting. Empty when unknown.
  pub language: Buffer,
  /// How many highlights the frame has, for `parcel_diagnostic_get_code_highlight()`.
  pub highlight_count: usize,
}

impl_extensible!(
  CodeFrameInfo,
  min_size = std::mem::offset_of!(CodeFrameInfo, highlight_count) + size_of::<usize>()
);

/// Fills in `*out` with code frame `frame` of the diagnostic. Returns false,
/// writing nothing, when there is no such frame or `out->size` is unset.
pub extern "C" fn parcel_diagnostic_get_code_frame(
  out: *mut CodeFrameInfo,
  diagnostics: DiagnosticsRef,
  index: usize,
  frame: usize,
) -> bool {
  if out.is_null() {
    return false;
  }
  let Some(frame) = code_frame(diagnostics, index, frame) else {
    return false;
  };

  let mut info = CodeFrameInfo::default();
  if let Some(url) = &frame.url {
    if let Ok(path) = url.to_file_path() {
      let path = path.to_path_buf().to_string_lossy().into_owned();
      unsafe { write_buffer(&mut info.file_path, path.into_bytes(), true) };
    }
    unsafe { write_buffer(&mut info.url, url.to_string().into_bytes(), true) };
  }
  if let Some(code) = &frame.code {
    unsafe { write_buffer(&mut info.code, code.as_bytes().to_vec(), true) };
  }
  if let Some(language) = &frame.language {
    let extension = language.extension().as_bytes().to_vec();
    unsafe { write_buffer(&mut info.language, extension, true) };
  }
  info.highlight_count = frame.code_highlights.len();

  unsafe {
    write_info(out, info, |info| {
      [
        &mut info.file_path,
        &mut info.url,
        &mut info.code,
        &mut info.language,
      ]
    })
  }
}

/// One highlighted range in a code frame, filled in by
/// `parcel_diagnostic_get_code_highlight()`. Lines and columns are 1-based, and
/// the end is the last highlighted character.
///
/// Set `size` before the call, as `CodeHighlightInfo info = {.size = sizeof(CodeHighlightInfo)};`;
/// Parcel writes only the fields that fit. Free `message` after.
#[repr(C)]
pub struct CodeHighlightInfo {
  /// `sizeof(CodeHighlightInfo)` as the caller was built. Always the first member.
  pub size: usize,
  pub start_line: u32,
  pub start_column: u32,
  pub end_line: u32,
  pub end_column: u32,
  /// A message shown at the highlight. Empty when it has none.
  pub message: Buffer,
}

impl_extensible!(
  CodeHighlightInfo,
  min_size = std::mem::offset_of!(CodeHighlightInfo, message) + size_of::<Buffer>()
);

/// Fills in `*out` with highlight `highlight` of code frame `frame` of the
/// diagnostic. Returns false, writing nothing, when there is no such highlight
/// or `out->size` is unset.
pub extern "C" fn parcel_diagnostic_get_code_highlight(
  out: *mut CodeHighlightInfo,
  diagnostics: DiagnosticsRef,
  index: usize,
  frame: usize,
  highlight: usize,
) -> bool {
  if out.is_null() {
    return false;
  }
  let Some(highlight) =
    code_frame(diagnostics, index, frame).and_then(|frame| frame.code_highlights.get(highlight))
  else {
    return false;
  };

  let mut info = CodeHighlightInfo {
    start_line: highlight.start.line,
    start_column: highlight.start.column,
    end_line: highlight.end.line,
    end_column: highlight.end.column,
    ..Default::default()
  };
  if let Some(message) = &highlight.message {
    unsafe { write_buffer(&mut info.message, message.as_bytes().to_vec(), true) };
  }

  unsafe { write_info(out, info, |info| [&mut info.message]) }
}

/// Writes `info` into a struct the plugin allocated, freeing the buffers of any
/// field that does not fit within its `size` rather than leaking them.
///
/// # Safety
///
/// `out` must be non-null and point to `(*out).size` writable bytes.
unsafe fn write_info<T: Extensible, const N: usize>(
  out: *mut T,
  mut info: T,
  buffers: impl Fn(&mut T) -> [&mut Buffer; N],
) -> bool {
  let size = unsafe { out.cast::<usize>().read() };
  if size < T::MIN_SIZE {
    for buffer in buffers(&mut info) {
      parcel_free_buffer(buffer);
    }
    return false;
  }

  // Every buffer is in the first layout today, which every caller has room
  // for. One appended later must be freed here when it lies past `size`.
  let base = &mut info as *mut T as usize;
  for buffer in buffers(&mut info) {
    let offset = buffer as *mut Buffer as usize - base;
    if offset + size_of::<Buffer>() > size {
      parcel_free_buffer(buffer);
      *buffer = Buffer::default();
    }
  }
  unsafe { write_extensible(out, info) }
}
