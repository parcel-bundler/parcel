//! Plugin diagnostics and conversion to Parcel core diagnostics.

use std::path::Path;

use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic as CoreDiagnostic,
  DiagnosticSeverity as CoreDiagnosticSeverity, Location, PathId, SourceUrl,
};

use crate::{
  Buffer, Diagnostics, OptionsContext, diagnostics::DiagnosticsView, extensible::read_extensible,
  parcel_buffer_free,
};

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

pub type DiagnosticSeverityFFI = u8;

impl DiagnosticSeverity {
  /// The severity a plugin wrote. One this version of Parcel does not know is an
  /// error: a diagnostic is still worth showing when its severity is unclear.
  pub(crate) fn from_raw(severity: DiagnosticSeverityFFI) -> Self {
    Self::try_from(severity).unwrap_or(Self::PARCEL_SEVERITY_ERROR)
  }
}

impl_enum_conversion! {
  CoreDiagnosticSeverity => DiagnosticSeverity {
    CoreDiagnosticSeverity::Error => DiagnosticSeverity::PARCEL_SEVERITY_ERROR,
    CoreDiagnosticSeverity::Warning => DiagnosticSeverity::PARCEL_SEVERITY_WARNING,
    CoreDiagnosticSeverity::SourceError => DiagnosticSeverity::PARCEL_SEVERITY_SOURCE_ERROR,
    CoreDiagnosticSeverity::Info => DiagnosticSeverity::PARCEL_SEVERITY_INFO,
  }
}

/// Describes a diagnostic a plugin reports: the error an entry point fails with,
/// or a warning it logs with `parcel_options_log_diagnostic()`.
///
/// Parcel allocates the one each entry point receives, zeroed apart from `size`
/// and `diagnostics`, and frees every `Buffer` in it once the call returns; fill
/// them with `parcel_buffer_alloc()`. The call fails when `message` is set, or
/// `diagnostics` holds any. To log one, initialize it as
/// `DiagnosticOptions d = {.size = sizeof(DiagnosticOptions)};`, and free its
/// buffers after the call: Parcel copies what it needs.
///
/// Its own fields describe one diagnostic with at most one code frame,
/// highlight and hint. Anything more is built in a list instead:
/// `parcel_diagnostics_push()` a diagnostic to it, then add to it with
/// `parcel_diagnostics_add_code_frame()`, `parcel_diagnostics_add_code_highlight()`
/// and `parcel_diagnostics_add_hint()`, which take their strings as a pointer
/// and length, so nothing needs allocating. The list to fail an entry point with
/// is already in the `diagnostics` field of the one it received; to log one,
/// create a list with `parcel_diagnostics_create()` and set `diagnostics` to it.
/// Where Parcel provides these, building every diagnostic this way, leaving the
/// struct's own fields empty, is simplest.
///
/// To report diagnostics Parcel handed the plugin, such as those of a failed read,
/// set `diagnostics` to their list instead. Either way, Parcel reports the list's
/// diagnostics after the one `message` describes, if it is set too.
///
/// Only write fields that fit within `size`, which an older Parcel sets lower than
/// `sizeof(DiagnosticOptions)`; `PARCEL_HAS_FIELD()` checks. Parcel ignores fields it
/// does not know, since the rest is still worth showing.
#[repr(C)]
pub struct DiagnosticOptions {
  /// `sizeof(DiagnosticOptions)` as whoever allocated it was built. Always the first member.
  pub size: usize,
  pub message: Buffer,
  /// Absolute path of the file the diagnostic's code frame shows, if it has one.
  pub file_path: Buffer,
  /// 1-based line and column of the first highlighted character in `file_path`, or 0 for no
  /// highlight.
  pub line: u32,
  pub column: u32,
  pub hint: Buffer,
  /// `PARCEL_SEVERITY_*`
  pub severity: DiagnosticSeverityFFI,
  /// A message shown at the highlight.
  pub highlight_message: Buffer,
  /// 1-based line and column of the last highlighted character, or 0 to highlight just the one at
  /// `line` and `column`.
  pub end_line: u32,
  pub end_column: u32,
  /// A URL to documentation about the diagnostic.
  pub documentation_url: Buffer,
  /// Diagnostics to report as well, or 0: a list the plugin built or Parcel handed it during this
  /// call. A list from any other call is ignored. In the one an entry point receives, Parcel sets
  /// it to an empty list for the plugin to push to; an older Parcel leaves it 0.
  pub diagnostics: Diagnostics,
}

// Every field is in the first layout: none was published before the first alpha.
impl_extensible!(
  DiagnosticOptions,
  min_size = std::mem::offset_of!(DiagnosticOptions, diagnostics) + size_of::<Diagnostics>()
);

// ── Internal diagnostic helpers ───────────────────────────────────────────────

/// Reads the diagnostics a plugin wrote into an entry point's out-param, then
/// frees the buffers it allocated. Empty when it reported none.
///
/// `context` is the call's, which an attached `diagnostics` list must belong to.
/// Without one, only the diagnostic the struct itself describes is read: a call
/// with no `Options`, such as a custom content read, reads its out-param's list
/// with [`read_out_diagnostic`] instead.
///
/// To read one the plugin still owns — a logged diagnostic, say — use
/// [`copy_cdiagnostic`].
pub(crate) fn read_cdiagnostic(
  diag: &mut DiagnosticOptions,
  context: Option<&OptionsContext>,
) -> Vec<CoreDiagnostic> {
  let diagnostics = copy_cdiagnostic(diag, context);

  // Unconditionally, including when there was no message to read: a plugin that
  // filled in a file path but no message would otherwise leak it.
  for buffer in [
    &mut diag.message,
    &mut diag.file_path,
    &mut diag.hint,
    &mut diag.highlight_message,
    &mut diag.documentation_url,
  ] {
    parcel_buffer_free(buffer);
  }

  diagnostics
}

/// [`read_cdiagnostic`], for a call with no [`OptionsContext`], whose
/// out-param's list is `out`.
pub(crate) fn read_out_diagnostic(
  diag: &mut DiagnosticOptions,
  out: &DiagnosticsView,
) -> Vec<CoreDiagnostic> {
  let attached = diag.diagnostics;
  let mut diagnostics = read_cdiagnostic(diag, None);
  if attached == out.handle() {
    diagnostics.extend(out.to_vec());
  }
  diagnostics
}

/// Reads a diagnostic a plugin allocated, e.g. to log it, without taking ownership of its buffers.
/// Empty when it describes none, or its `size` is unset.
///
/// # Safety
///
/// `diag` must be non-null and point to `(*diag).size` readable bytes.
pub(crate) unsafe fn copy_plugin_cdiagnostic(
  diag: *const DiagnosticOptions,
  context: Option<&OptionsContext>,
) -> Vec<CoreDiagnostic> {
  match unsafe { read_extensible(diag) } {
    Some((diag, _)) => copy_cdiagnostic(&diag, context),
    None => Vec::new(),
  }
}

/// Reads the diagnostics a plugin wrote without taking ownership of its buffers:
/// the one the struct describes, if it has a message, then those of the attached
/// list, if `context` handed it out.
pub(crate) fn copy_cdiagnostic(
  diag: &DiagnosticOptions,
  context: Option<&OptionsContext>,
) -> Vec<CoreDiagnostic> {
  let mut diagnostics = Vec::new();

  if !diag.message.data.is_null() {
    let read_buf = |buf: &Buffer| -> Option<String> {
      (!buf.data.is_null()).then(|| unsafe {
        String::from_utf8_lossy(std::slice::from_raw_parts(buf.data, buf.len)).into_owned()
      })
    };

    let code_frames = read_buf(&diag.file_path)
      .map(|path| {
        let url = Some(SourceUrl::from_path(&PathId::new(Path::new(&path))));
        let code_highlights = if diag.line > 0 {
          let start = Location {
            line: diag.line,
            column: diag.column.max(1),
          };
          let end = if diag.end_line > 0 {
            Location {
              line: diag.end_line,
              column: diag.end_column.max(1),
            }
          } else {
            start.clone()
          };
          vec![CodeHighlight {
            start,
            end,
            message: read_buf(&diag.highlight_message),
          }]
        } else {
          vec![]
        };
        vec![CodeFrame {
          url,
          code_highlights,
          ..Default::default()
        }]
      })
      .unwrap_or_default();

    diagnostics.push(CoreDiagnostic {
      message: read_buf(&diag.message).unwrap_or_default(),
      severity: CoreDiagnosticSeverity::from(DiagnosticSeverity::from_raw(diag.severity)),
      code_frames,
      hints: read_buf(&diag.hint).into_iter().collect(),
      origin: None,
      documentation_url: read_buf(&diag.documentation_url),
    });
  }

  if let Some(attached) = context.and_then(|context| context.call_diagnostics(diag.diagnostics)) {
    diagnostics.extend(attached);
  }

  diagnostics
}
