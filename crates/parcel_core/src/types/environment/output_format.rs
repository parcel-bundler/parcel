use std::fmt::Display;

use serde::{Deserialize, Serialize};

/// The JavaScript bundle output format
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
  /// A classic script that can be loaded in a <script> tag in the browser
  ///
  /// This is unsupported for library targets.
  ///
  Global,

  /// A CommonJS module that outputs require and module.exports
  ///
  /// This format is typically loaded in Node.js.
  ///
  CommonJS,

  /// An ES Module that outputs import and export statements
  ///
  /// ES Modules are often loaded using a <script type="module"> tag in the browser.
  ///
  #[default]
  EsModule,
}

impl Display for OutputFormat {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      OutputFormat::Global => write!(f, "global"),
      OutputFormat::CommonJS => write!(f, "commonjs"),
      OutputFormat::EsModule => write!(f, "esmodule"),
    }
  }
}
