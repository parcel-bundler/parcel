use serde::Deserialize;
use serde::Serialize;

use super::environment::Environment;
use super::source::SourceLocation;

/// A targets describes how Parcel should compile source code
///
/// For example, you could have a "modern" target that compiles code for new browsers and a
/// "legacy" target for older browsers.
///
#[derive(PartialEq, Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  /// The output folder for compiled bundles
  pub dist_dir: String,

  /// The output filename of the entry
  pub dist_entry: Option<String>,

  /// The environment the code will run in
  ///
  /// This influences how Parcel compiles your code, including what syntax to transpile.
  ///
  pub env: Environment,

  /// The location that created the target
  ///
  /// For example, this may refer to the position of the main field in a package.json file.
  ///
  pub loc: Option<SourceLocation>,

  /// The name of the target
  pub name: String,

  /// The URL bundles will be loaded with at runtime
  pub public_url: String,
}
