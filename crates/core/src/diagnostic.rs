use std::{borrow::Cow, path::PathBuf};

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

pub(crate) struct EscapeMarkdown<'a, T>(pub &'a T);

fn escape(s: &str) -> Cow<'_, str> {
  let mut result = Cow::Borrowed("");
  let mut start = 0;
  for (index, matched) in s.match_indices(&['*', '_', '~', '\\']) {
    result += &s[start..index];
    result += "\\";
    result += matched;
    start = index + 1;
  }

  result += &s[start..];
  result
}

impl<'a, T: std::fmt::Debug> std::fmt::Debug for EscapeMarkdown<'a, T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let res = format!("{:?}", self.0);
    escape(&res).fmt(f)
  }
}

impl<'a, T: std::fmt::Display> std::fmt::Display for EscapeMarkdown<'a, T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let res = format!("{}", self.0);
    escape(&res).fmt(f)
  }
}

macro_rules! format_markdown {
  ($s: literal, $($arg: expr),+) => {
    format!($s, $(crate::diagnostic::EscapeMarkdown(&$arg)),+)
  };
}

pub(crate) use format_markdown;
