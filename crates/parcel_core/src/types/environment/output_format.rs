use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

/// The JavaScript bundle output format
#[derive(Clone, Copy, Debug, Default, Deserialize_repr, Eq, Hash, PartialEq, Serialize_repr)]
#[repr(u8)]
pub enum OutputFormat {
  /// A classic script that can be loaded in a <script> tag in the browser
  ///
  /// This is unsupported for library targets.
  ///
  Global = 0,

  /// A CommonJS module that outputs require and module.exports
  ///
  /// This format is typically loaded in Node.js.
  ///
  Commonjs = 1,

  /// An ES Module that outputs import and export statements
  ///
  /// ES Modules are often loaded using a <script type="module"> tag in the browser.
  ///
  #[default]
  EsModule = 2,
}
