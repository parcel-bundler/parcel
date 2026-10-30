//! Plugin diagnostics and conversion to Parcel core diagnostics.

use std::path::Path;

use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic as CoreDiagnostic,
  DiagnosticSeverity as CoreDiagnosticSeverity, Location, PathId, SourceUrl,
};

use crate::{Buffer, Diagnostics, OptionsContext, extensible::read_extensible, parcel_free_buffer};

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
/// Parcel allocates the one each entry point receives, zeroed apart from `size`,
/// and frees every `Buffer` in it once the call returns; fill them with
/// `parcel_buffer_alloc()`. The call fails when `message` or `diagnostics` is set.
/// To log one, initialize it as `DiagnosticOptions d = {.size = sizeof(DiagnosticOptions)};`,
/// and free its buffers after the call: Parcel copies what it needs.
///
/// It describes one diagnostic with at most one code frame, highlight and hint.
/// To report diagnostics Parcel handed the plugin, such as those of a failed read,
/// set `diagnostics` to their list. Parcel reports them exactly as they were, after
/// the diagnostic `message` describes, if it is set too.
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
  /// Diagnostics Parcel handed the plugin during this call, to report as well, or 0. A list from
  /// any other call is ignored.
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
/// Without one, as during init or a custom content read, only the diagnostic the
/// struct itself describes is read.
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
    parcel_free_buffer(buffer);
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
