//! Lists of diagnostics: those a reporter event carries, those Parcel hands a
//! plugin during a call, such as a failed read's, and those a plugin builds to
//! report, which it can add to.
//!
//! A [`DiagnosticsRef`] handle is valid only for the duration of the call it was
//! passed to or obtained in.
//!
//! Out-of-range indices are not an error: a getter writes nothing, and a count
//! returns 0. A reporter walking a list it did not build should not have to
//! bounds-check every call to avoid taking the build down.

use std::{borrow::Cow, sync::Mutex};

use parcel_core::{
  AssetType, CodeFrame, CodeHighlight, Diagnostic as CoreDiagnostic, Location, PathId, SourceUrl,
};

use crate::{
  Buffer, DiagnosticOptions, DiagnosticSeverity, DiagnosticSeverityFFI, Diagnostics,
  DiagnosticsRef, Options,
  extensible::{Extensible, read_extensible, write_extensible},
  options_context, parcel_buffer_free, plugin_bytes, write_buffer,
};

/// What a [`DiagnosticsRef`] handle points to: a reporter event's diagnostics,
/// borrowed, or a list owned by the call that handed it out. Host-side only — a
/// plugin sees the opaque `u64`, which is why this is not part of the generated
/// header.
///
/// Behind a mutex because a plugin may add to a writable list from several
/// threads during one call, while others read it.
pub(crate) struct DiagnosticsView<'a> {
  diagnostics: Mutex<Cow<'a, [CoreDiagnostic]>>,
  /// Whether the plugin may add to it: true for the lists it reports through,
  /// false for those Parcel handed it, which it reports exactly as they were.
  writable: bool,
}

impl<'a> DiagnosticsView<'a> {
  /// A list the plugin only reads.
  pub(crate) fn read_only(diagnostics: Cow<'a, [CoreDiagnostic]>) -> Self {
    DiagnosticsView {
      diagnostics: Mutex::new(diagnostics),
      writable: false,
    }
  }

  /// An empty list the plugin can add to. Allocates nothing until it does.
  pub(crate) fn writable() -> Self {
    DiagnosticsView {
      diagnostics: Mutex::new(Cow::Owned(Vec::new())),
      writable: true,
    }
  }

  pub(crate) fn handle(&self) -> Diagnostics {
    self as *const DiagnosticsView as Diagnostics
  }

  /// A diagnostic out-param whose `diagnostics` is this list, for an entry
  /// point to push what it reports to.
  pub(crate) fn out_param(&self) -> DiagnosticOptions {
    DiagnosticOptions {
      diagnostics: self.handle(),
      ..DiagnosticOptions::default()
    }
  }

  pub(crate) fn to_vec(&self) -> Vec<CoreDiagnostic> {
    self.diagnostics.lock().unwrap().to_vec()
  }
}

/// # Safety
///
/// `diagnostics` must be 0 or a live handle.
unsafe fn view<'h>(diagnostics: DiagnosticsRef) -> Option<&'h DiagnosticsView<'h>> {
  (diagnostics != 0).then(|| unsafe { &*(diagnostics as *const DiagnosticsView) })
}

/// Calls `f` with diagnostic `index` of the list, if it has one.
fn with_diagnostic<R>(
  diagnostics: DiagnosticsRef,
  index: usize,
  f: impl FnOnce(&CoreDiagnostic) -> R,
) -> Option<R> {
  let view = unsafe { view(diagnostics) }?;
  let list = view.diagnostics.lock().unwrap();
  list.get(index).map(f)
}

/// Calls `f` with code frame `frame` of diagnostic `index`, if it has one.
fn with_code_frame<R>(
  diagnostics: DiagnosticsRef,
  index: usize,
  frame: usize,
  f: impl FnOnce(&CodeFrame) -> R,
) -> Option<R> {
  with_diagnostic(diagnostics, index, |diagnostic| {
    diagnostic.code_frames.get(frame).map(f)
  })
  .flatten()
}

/// Returns how many diagnostics the list holds. 0 when it holds none.
pub extern "C" fn parcel_diagnostics_get_count(diagnostics: DiagnosticsRef) -> usize {
  unsafe { view(diagnostics) }.map_or(0, |view| view.diagnostics.lock().unwrap().len())
}

/// Returns the diagnostic's message into `*buf`.
/// Caller must `parcel_buffer_free(buf)`.
pub extern "C" fn parcel_diagnostic_get_message(
  buf: *mut Buffer,
  diagnostics: DiagnosticsRef,
  index: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(message) = with_diagnostic(diagnostics, index, |d| d.message.clone()) {
    unsafe { write_buffer(buf, message.into_bytes(), true) };
  }
}

/// Returns the diagnostic's severity (`PARCEL_SEVERITY_*`), or
/// `PARCEL_SEVERITY_ERROR` when `index` is out of range.
pub extern "C" fn parcel_diagnostic_get_severity(
  diagnostics: DiagnosticsRef,
  index: usize,
) -> DiagnosticSeverity {
  with_diagnostic(diagnostics, index, |diagnostic| {
    DiagnosticSeverity::from(diagnostic.severity.clone())
  })
  .unwrap_or(DiagnosticSeverity::PARCEL_SEVERITY_ERROR)
}

/// Returns the name of the plugin the diagnostic came from into `*buf`, if it
/// recorded one. Leaves `buf->data == NULL` when it did not.
/// Caller must `parcel_buffer_free(buf)` when `data != NULL`.
pub extern "C" fn parcel_diagnostic_get_origin(
  buf: *mut Buffer,
  diagnostics: DiagnosticsRef,
  index: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(origin) = with_diagnostic(diagnostics, index, |d| d.origin.clone()).flatten() {
    unsafe { write_buffer(buf, origin.into_bytes(), true) };
  }
}

/// Returns how many hints the diagnostic has.
pub extern "C" fn parcel_diagnostic_get_hint_count(
  diagnostics: DiagnosticsRef,
  index: usize,
) -> usize {
  with_diagnostic(diagnostics, index, |diagnostic| diagnostic.hints.len()).unwrap_or(0)
}

/// Returns one of the diagnostic's hints into `*buf`.
/// Caller must `parcel_buffer_free(buf)`.
pub extern "C" fn parcel_diagnostic_get_hint(
  buf: *mut Buffer,
  diagnostics: DiagnosticsRef,
  index: usize,
  hint: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(hint) = with_diagnostic(diagnostics, index, |d| d.hints.get(hint).cloned()).flatten()
  {
    unsafe { write_buffer(buf, hint.into_bytes(), true) };
  }
}

/// Returns the URL of documentation about the diagnostic into `*buf`, or leaves
/// `buf->data == NULL` when it has none.
/// Caller must `parcel_buffer_free(buf)` when `data != NULL`.
pub extern "C" fn parcel_diagnostic_get_documentation_url(
  buf: *mut Buffer,
  diagnostics: DiagnosticsRef,
  index: usize,
) {
  if buf.is_null() {
    return;
  }
  if let Some(url) = with_diagnostic(diagnostics, index, |d| d.documentation_url.clone()).flatten()
  {
    unsafe { write_buffer(buf, url.into_bytes(), true) };
  }
}

/// Returns how many code frames the diagnostic has: excerpts of the files it is
/// about, with parts of them highlighted.
pub extern "C" fn parcel_diagnostic_get_code_frame_count(
  diagnostics: DiagnosticsRef,
  index: usize,
) -> usize {
  with_diagnostic(diagnostics, index, |diagnostic| {
    diagnostic.code_frames.len()
  })
  .unwrap_or(0)
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
  let Some(info) = with_code_frame(diagnostics, index, frame, |frame| {
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
    info
  }) else {
    return false;
  };

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
  let Some(info) = with_code_frame(diagnostics, index, frame, |frame| {
    let highlight = frame.code_highlights.get(highlight)?;
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
    Some(info)
  })
  .flatten() else {
    return false;
  };

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
      parcel_buffer_free(buffer);
    }
    return false;
  }

  // Every buffer is in the first layout today, which every caller has room
  // for. One appended later must be freed here when it lies past `size`.
  let base = &mut info as *mut T as usize;
  for buffer in buffers(&mut info) {
    let offset = buffer as *mut Buffer as usize - base;
    if offset + size_of::<Buffer>() > size {
      parcel_buffer_free(buffer);
      *buffer = Buffer::default();
    }
  }
  unsafe { write_extensible(out, info) }
}

// ── Building diagnostics to report ────────────────────────────────────────────

/// The list `diagnostics` points to, if the plugin may add to it.
fn writable<'h>(diagnostics: Diagnostics) -> Option<&'h DiagnosticsView<'h>> {
  unsafe { view(diagnostics) }.filter(|view| view.writable)
}

/// Calls `f` with the last diagnostic in a writable list. Returns false, doing
/// nothing, when the list is not one the plugin may add to, or is empty.
fn with_last(diagnostics: Diagnostics, f: impl FnOnce(&mut CoreDiagnostic) -> bool) -> bool {
  let Some(view) = writable(diagnostics) else {
    return false;
  };
  let mut list = view.diagnostics.lock().unwrap();
  list.to_mut().last_mut().is_some_and(f)
}

/// A string the plugin passed as `data` and `len`. `None` when it is empty.
fn input_string(data: *const u8, len: usize) -> Option<String> {
  let bytes = unsafe { plugin_bytes(data, len) };
  (!bytes.is_empty()).then(|| String::from_utf8_lossy(bytes).into_owned())
}

/// Returns a new, empty list of diagnostics, for building ones to log with
/// `parcel_options_log_diagnostic()` by setting `DiagnosticOptions.diagnostics`
/// to it. Parcel frees it when the call returns. 0 when `options` is.
///
/// To fail a call, there is no need for one: push to the list in the
/// `diagnostics` field of the `DiagnosticOptions` the entry point received.
pub extern "C" fn parcel_diagnostics_create(options: Options) -> Diagnostics {
  if options == 0 {
    return 0;
  }
  unsafe { options_context(options) }.create_list()
}

/// A diagnostic to append to a list with `parcel_diagnostics_push()`. Add its
/// code frames and hints with the calls that follow.
///
/// Initialize it as `DiagnosticEntryOptions d = {.size = sizeof(DiagnosticEntryOptions)};`.
/// Like every input to a call, Parcel only reads it during the call: its
/// strings may point at the plugin's own memory, which the plugin still owns.
/// None of them is NUL-terminated.
#[repr(C)]
pub struct DiagnosticEntryOptions {
  /// `sizeof(DiagnosticEntryOptions)` as the plugin was built. Always the first member.
  pub size: usize,
  pub severity: DiagnosticSeverityFFI,
  /// What went wrong. Required.
  pub message: *const u8,
  pub message_len: usize,
  /// A URL to documentation about the diagnostic. Empty when it has none.
  pub documentation_url: *const u8,
  pub documentation_url_len: usize,
}

impl_extensible!(
  DiagnosticEntryOptions,
  min_size =
    std::mem::offset_of!(DiagnosticEntryOptions, documentation_url_len) + size_of::<usize>()
);

/// A code frame to add with `parcel_diagnostics_add_code_frame()`: an excerpt of
/// a file the diagnostic is about. Add its highlights with
/// `parcel_diagnostics_add_code_highlight()`.
///
/// Initialize it as `CodeFrameOptions f = {.size = sizeof(CodeFrameOptions)};`.
/// Parcel only reads it during the call. None of its strings is NUL-terminated.
#[repr(C)]
pub struct CodeFrameOptions {
  /// `sizeof(CodeFrameOptions)` as the plugin was built. Always the first member.
  pub size: usize,
  /// The absolute path of the file, for one on disk. Empty to name it with `url`.
  pub file_path: *const u8,
  pub file_path_len: usize,
  /// The URL of the file, for one that is not on disk. Ignored when `file_path` is set.
  pub url: *const u8,
  pub url_len: usize,
  /// The code to show. Empty to show the file's contents.
  pub code: *const u8,
  pub code_len: usize,
  /// The code's language, as a file extension, for syntax highlighting. Empty when unknown.
  pub language: *const u8,
  pub language_len: usize,
}

impl_extensible!(
  CodeFrameOptions,
  min_size = std::mem::offset_of!(CodeFrameOptions, language_len) + size_of::<usize>()
);

/// A highlight to add with `parcel_diagnostics_add_code_highlight()`. Lines and
/// columns are 1-based, and the end is the last highlighted character.
///
/// Initialize it as `CodeHighlightOptions h = {.size = sizeof(CodeHighlightOptions)};`.
/// Parcel only reads it during the call. `message` is not NUL-terminated.
#[repr(C)]
pub struct CodeHighlightOptions {
  /// `sizeof(CodeHighlightOptions)` as the plugin was built. Always the first member.
  pub size: usize,
  /// Required.
  pub start_line: u32,
  pub start_column: u32,
  /// 0 to highlight just the character at the start.
  pub end_line: u32,
  pub end_column: u32,
  /// A message shown at the highlight. Empty when it has none.
  pub message: *const u8,
  pub message_len: usize,
}

impl_extensible!(
  CodeHighlightOptions,
  min_size = std::mem::offset_of!(CodeHighlightOptions, message_len) + size_of::<usize>()
);

/// Appends the diagnostic `diagnostic` describes to `diagnostics`.
///
/// `diagnostics` must be a list from the current call. The plugin may add to
/// the one in the `DiagnosticOptions` an entry point received, and to those
/// from `parcel_diagnostics_create()`. Returns false, adding nothing, for a
/// list Parcel handed it to read, such as a failed read's, or when the
/// diagnostic has no message or its `size` is unset. Parcel cannot tell any
/// other value from a list: passing one, such as a list kept from an earlier
/// call, or an `Options` handle, is undefined behavior.
pub extern "C" fn parcel_diagnostics_push(
  diagnostics: Diagnostics,
  diagnostic: *const DiagnosticEntryOptions,
) -> bool {
  let Some(view) = writable(diagnostics) else {
    return false;
  };
  if diagnostic.is_null() {
    return false;
  }
  let Some((options, _)) = (unsafe { read_extensible(diagnostic) }) else {
    return false;
  };
  let Some(message) = input_string(options.message, options.message_len) else {
    return false;
  };
  let diagnostic = CoreDiagnostic {
    severity: DiagnosticSeverity::from_raw(options.severity).into(),
    documentation_url: input_string(options.documentation_url, options.documentation_url_len),
    ..CoreDiagnostic::from_message(message)
  };
  view.diagnostics.lock().unwrap().to_mut().push(diagnostic);
  true
}

/// Adds a code frame to the last diagnostic in `diagnostics`, which must be a
/// list `parcel_diagnostics_push()` accepts.
///
/// Returns false, adding nothing, when the list has no diagnostic or cannot be
/// added to, or `frame->size` is unset.
pub extern "C" fn parcel_diagnostics_add_code_frame(
  diagnostics: Diagnostics,
  frame: *const CodeFrameOptions,
) -> bool {
  if frame.is_null() {
    return false;
  }
  let Some((options, _)) = (unsafe { read_extensible(frame) }) else {
    return false;
  };
  let url = match input_string(options.file_path, options.file_path_len) {
    Some(path) => Some(SourceUrl::from_path(&PathId::new(std::path::Path::new(
      &path,
    )))),
    None => input_string(options.url, options.url_len).and_then(|url| SourceUrl::parse(&url).ok()),
  };
  let frame = CodeFrame {
    url,
    code: input_string(options.code, options.code_len),
    language: input_string(options.language, options.language_len)
      .map(|ext| AssetType::from_extension(&ext)),
    code_highlights: Vec::new(),
  };
  with_last(diagnostics, |diagnostic| {
    diagnostic.code_frames.push(frame);
    true
  })
}

/// Adds a highlight to the last code frame of the last diagnostic in
/// `diagnostics`, which must be a list `parcel_diagnostics_push()` accepts.
///
/// Returns false, adding nothing, when there is no frame to add it to,
/// `start_line` is 0, or `highlight->size` is unset.
pub extern "C" fn parcel_diagnostics_add_code_highlight(
  diagnostics: Diagnostics,
  highlight: *const CodeHighlightOptions,
) -> bool {
  if highlight.is_null() {
    return false;
  }
  let Some((options, _)) = (unsafe { read_extensible(highlight) }) else {
    return false;
  };
  if options.start_line == 0 {
    return false;
  }
  let start = Location {
    line: options.start_line,
    column: options.start_column.max(1),
  };
  let end = if options.end_line > 0 {
    Location {
      line: options.end_line,
      column: options.end_column.max(1),
    }
  } else {
    start.clone()
  };
  let highlight = CodeHighlight {
    start,
    end,
    message: input_string(options.message, options.message_len),
  };
  with_last(diagnostics, |diagnostic| {
    let Some(frame) = diagnostic.code_frames.last_mut() else {
      return false;
    };
    frame.code_highlights.push(highlight);
    true
  })
}

/// Adds a hint to the last diagnostic in `diagnostics`, which must be a list
/// `parcel_diagnostics_push()` accepts. Returns false, adding nothing, when
/// there is no diagnostic to add it to, or the hint is empty.
pub extern "C" fn parcel_diagnostics_add_hint(
  diagnostics: Diagnostics,
  hint: *const u8,
  hint_len: usize,
) -> bool {
  let hint = unsafe { plugin_bytes(hint, hint_len) };
  if hint.is_empty() {
    return false;
  }
  let hint = String::from_utf8_lossy(hint).into_owned();
  with_last(diagnostics, |diagnostic| {
    diagnostic.hints.push(hint);
    true
  })
}
