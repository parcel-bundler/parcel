//! Plugin diagnostics and conversion to Parcel core diagnostics.

use std::path::Path;

use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic as CoreDiagnostic,
  DiagnosticSeverity as CoreDiagnosticSeverity, Location, PathId, SourceUrl,
};

use crate::{Buffer, parcel_free_buffer};

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

/// Diagnostic written by a plugin to report an error or warning.
/// The host zero-initialises this before every plugin call.
/// Fill via `parcel_buffer_alloc()`; host frees all `Buffer` fields after the call.
/// If `message.data == NULL` after the call, no diagnostic was set.
#[repr(C)]
#[derive(Default)]
pub struct Diagnostic {
  pub message: Buffer,
  pub file_path: Buffer,
  pub line: u32,
  pub column: u32,
  pub hint: Buffer,
  /// `PARCEL_SEVERITY_*`
  pub severity: DiagnosticSeverity,
}

// ── Internal diagnostic helpers ───────────────────────────────────────────────

pub(crate) fn read_cdiagnostic(
  diag: &mut Diagnostic,
  project_root: Option<&PathId>,
) -> Option<CoreDiagnostic> {
  if diag.message.data.is_null() {
    return None;
  }

  let read_buf = |buf: &mut Buffer| -> String {
    let s = unsafe {
      std::str::from_utf8(std::slice::from_raw_parts(buf.data, buf.len))
        .unwrap_or("")
        .to_owned()
    };
    parcel_free_buffer(buf);
    s
  };

  let message = read_buf(&mut diag.message);
  let severity = match diag.severity {
    DiagnosticSeverity::PARCEL_SEVERITY_ERROR => CoreDiagnosticSeverity::Error,
    DiagnosticSeverity::PARCEL_SEVERITY_WARNING => CoreDiagnosticSeverity::Warning,
    DiagnosticSeverity::PARCEL_SEVERITY_SOURCE_ERROR => CoreDiagnosticSeverity::SourceError,
    DiagnosticSeverity::PARCEL_SEVERITY_INFO => CoreDiagnosticSeverity::Info,
  };

  let code_frames = if !diag.file_path.data.is_null() {
    let path_str = read_buf(&mut diag.file_path);
    if project_root.is_some() {
      let url = Some(SourceUrl::from_path(&PathId::new(Path::new(&path_str))));
      let code_highlights = if diag.line > 0 {
        vec![CodeHighlight {
          start: Location {
            line: diag.line,
            column: diag.column.max(1),
          },
          end: Location {
            line: diag.line,
            column: diag.column.max(1),
          },
          message: None,
        }]
      } else {
        vec![]
      };
      vec![CodeFrame {
        url,
        code_highlights,
        ..Default::default()
      }]
    } else {
      vec![]
    }
  } else {
    vec![]
  };

  let hints = if !diag.hint.data.is_null() {
    vec![read_buf(&mut diag.hint)]
  } else {
    vec![]
  };

  Some(CoreDiagnostic {
    message,
    severity,
    code_frames,
    hints,
    origin: None,
    documentation_url: None,
  })
}
