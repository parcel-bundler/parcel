use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde::Serialize;

use super::environment::Environment;
use super::source::SourceLocation;

/// A target represents how and where source code is compiled
///
/// For example, a "modern" target would output code that can run on the latest browsers while a
/// "legacy" target generates code compatible with older browsers.
///
#[derive(PartialEq, Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  /// The output folder for compiled bundles
  pub dist_dir: PathBuf,

  /// The output filename of the entry
  pub dist_entry: Option<PathBuf>,

  /// The environment the code will run in
  ///
  /// This influences how Parcel compiles your code, including what syntax to transpile.
  ///
  pub env: Arc<Environment>,

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

impl Default for Target {
  fn default() -> Self {
    Self {
      dist_dir: PathBuf::default(),
      dist_entry: None,
      env: Arc::new(Environment::default()),
      loc: None,
      name: String::from("default"),
      public_url: String::from("/"),
    }
  }
}
