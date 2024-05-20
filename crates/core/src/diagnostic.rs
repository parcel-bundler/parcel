use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{
  intern::Interned,
  types::{AssetType, Location, SourceLocation},
};

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
  /// The message to log.
  pub message: String,
  /// Name of plugin or file that threw this error.
  pub origin: Option<String>,
  pub code_frames: Vec<CodeFrame>,
  pub hints: Vec<String>,
  pub severity: DiagnosticSeverity,
  #[serde(rename = "documentationURL")]
  pub documentation_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrame {
  pub code: Option<String>,
  pub file_path: Option<Interned<PathBuf>>,
  pub language: Option<AssetType>,
  pub code_highlights: Vec<CodeHighlight>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct CodeHighlight {
  pub message: Option<String>,
  pub start: Location,
  pub end: Location,
}

#[derive(Serialize, Deserialize, Debug, Eq, PartialEq, Clone)]
pub enum DiagnosticSeverity {
  /// Fails the build with an error.
  Error,
  /// Logs a warning, but the build does not fail.
  Warning,
  /// An error if this is source code in the project, or a warning if in node_modules.
  SourceError,
  /// An informative message.
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

  pub fn from_json(start: json_sourcemap::Location, end: json_sourcemap::Location) -> Self {
    CodeHighlight {
      message: None,
      start: Location {
        line: start.line as u32 + 1,
        column: start.column as u32 + 1,
      },
      end: Location {
        line: end.line as u32 + 1,
        column: end.column as u32,
      },
    }
  }
}

impl std::fmt::Display for Diagnostic {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.message)
  }
}

impl std::error::Error for Diagnostic {}

impl From<std::io::Error> for Diagnostic {
  fn from(value: std::io::Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl From<json_sourcemap::Error> for Diagnostic {
  fn from(value: json_sourcemap::Error) -> Self {
    Diagnostic {
      origin: Some("@parcel/core".into()),
      message: value.to_string(),
      code_frames: Vec::new(),
      hints: Vec::new(),
      severity: DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}
