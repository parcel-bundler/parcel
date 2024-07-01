use crate::{
  config_loader::ConfigFile,
  types::{FileType, Location, SourceLocation},
};
use derive_builder::Builder;
use serde::{Deserialize, Serialize};
use std::{
  fmt::{Display, Formatter},
  path::PathBuf,
};

use super::File;

/// This is a user facing error for Parcel.
///
/// Usually but not always this is linked to a source-code location.
#[derive(Builder, Debug, Serialize, Deserialize)]
#[builder(derive(Debug))]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
  /// A list of files with source-code highlights
  #[builder(default)]
  pub code_frames: Vec<CodeFrame>,

  /// URL for the user to refer to documentation
  #[builder(default)]
  #[serde(rename = "documentationURL")]
  pub documentation_url: Option<String>,

  /// Hints for the user
  #[builder(default)]
  pub hints: Vec<String>,

  /// A summary user-facing message
  pub message: String,

  /// Indicates where this diagnostic was emitted from
  ///
  /// Consumers can also enable backtraces for more detailed origin information.
  #[builder(default)]
  pub origin: Option<String>,
}

impl Display for Diagnostic {
  fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.message)
  }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Language(FileType);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrame {
  /// Source-code of the file at the time of error
  // TODO: might want to RC or intern
  pub code: Option<String>,

  /// List of source-code highlight messages
  pub code_highlights: Vec<CodeHighlight>,

  /// The language associated with the code
  pub language: Option<Language>,

  /// Path to the source file if applicable.
  // TODO: In the future we might need to discern between errors on a source file in disk or in-memory.
  pub path: Option<PathBuf>,
}

impl From<File> for CodeFrame {
  fn from(file: File) -> Self {
    let language = file
      .path
      .extension()
      .map(|ext| Language(FileType::from_extension(&ext.to_string_lossy())));

    CodeFrame {
      code: Some(file.contents),
      code_highlights: Vec::new(),
      language,
      path: Some(file.path),
    }
  }
}

impl<T> From<&ConfigFile<T>> for CodeFrame {
  fn from(file: &ConfigFile<T>) -> Self {
    CodeFrame::from(File {
      contents: file.raw.clone(),
      path: file.path.clone(),
    })
  }
}

/// Represents a snippet of code to highlight
#[derive(Serialize, Default, Deserialize, Debug, PartialEq, Clone)]
pub struct CodeHighlight {
  /// An optional message to display around the source-code range
  pub message: Option<String>,

  /// The start location to highlight
  pub start: Location,

  /// The end location to highlight
  pub end: Location,
}

impl From<[usize; 2]> for CodeHighlight {
  fn from(loc: [usize; 2]) -> Self {
    CodeHighlight {
      message: None,
      start: Location {
        line: loc[0],
        column: loc[1],
      },
      end: Location {
        line: loc[0] + 1,
        column: 1,
      },
    }
  }
}

impl From<SourceLocation> for CodeHighlight {
  fn from(loc: SourceLocation) -> Self {
    CodeHighlight {
      message: None,
      start: loc.start.clone(),
      end: Location {
        line: loc.end.line,
        column: loc.end.column - 1,
      },
    }
  }
}

#[doc(hidden)]
pub mod __diagnostic {
  #[doc(hidden)]
  pub use anyhow::anyhow;
}

#[macro_export]
macro_rules! diagnostic {
  ($fmt:expr, $($arg:tt)*) => {
    $crate::types::DiagnosticBuilder::default()
      .message(format!($fmt, $($arg)*))
      .origin(Some(module_path!().to_string()))
      .build()
      .unwrap()
  };
  ($msg:literal $(,)?) => {
    $crate::types::DiagnosticBuilder::default()
      .message($msg)
      .origin(Some(module_path!().to_string()))
      .build()
      .unwrap()
  };
  ($diagnostic:expr) => {
    $diagnostic
      .origin(Some(module_path!().to_string()))
      .build()
      .unwrap()
  };
}

// TODO Convert this to concrete error instead of anyhow! in follow up
#[macro_export]
macro_rules! diagnostic_error {
  ($fmt:expr, $($arg:tt)*) => {
    $crate::types::__diagnostic::anyhow!($fmt, $($arg)*)
  };
  ($msg:literal $(,)?) => {
    $crate::types::__diagnostic::anyhow!($msg)
  };
  ($diagnostic:expr) => {
    $crate::types::__diagnostic::anyhow!(
      $diagnostic
        .origin(Some(module_path!().to_string()))
        .build()
        .unwrap()
    )
  };
}
