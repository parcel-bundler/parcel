use crate::types::{FileType, Location, SourceLocation};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// This is a user facing error for Parcel.
///
/// Usually but not always this is linked to a source-code location.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
  /// The plugin/package this diagnostic was emitted from
  pub origin: String,
  /// A summary user-facing message
  pub message: String,
  /// A list of files with source-code highlights
  pub code_frames: Vec<CodeFrame>,
  /// Hints for the user
  pub hints: Vec<String>,
  /// Severity of the error
  pub severity: DiagnosticSeverity,
  /// URL for the user to refer to documentation
  #[serde(rename = "documentationURL")]
  pub documentation_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrame {
  /// List of source-code highlight messages
  pub code_highlights: Vec<CodeHighlight>,
  /// Source-code of the file at the time of error (TODO: might want to RC or intern)
  pub code: Option<String>,
  /// File-path of this source-file if applicable. In the future we might need to discern between
  /// errors on a source file in disk or in-memory.
  pub file_path: Option<PathBuf>,
  /// The file-type for this path.
  pub language: Option<FileType>,
}

/// A message around a source-code range
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct CodeHighlight {
  pub message: Option<String>,
  pub start: Location,
  pub end: Location,
}

#[derive(Default, Serialize, Deserialize, Debug, Eq, PartialEq, Clone)]
pub enum DiagnosticSeverity {
  /// Fails the build with an error.
  Error,
  /// Logs a warning, but the build does not fail.
  Warning,
  /// An error if this is source code in the project, or a warning if in node_modules.
  SourceError,
  /// An informative message.
  #[default]
  Info,
}

impl CodeHighlight {
  pub fn from_loc(loc: &SourceLocation, message: Option<String>) -> CodeHighlight {
    CodeHighlight {
      message,
      start: loc.start.clone(),
      end: Location {
        line: loc.end.line,
        column: loc.end.column - 1,
      },
    }
  }
}
