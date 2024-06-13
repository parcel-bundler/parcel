use std::hash::Hash;
use std::hash::Hasher;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use crate::types::Dependency;
use ahash::AHasher;
use parcel_filesystem::FileSystemRef;
use serde::Deserialize;
use serde::Serialize;

use super::bundle::BundleBehavior;
use super::environment::Environment;
use super::file_type::FileType;
use super::json::JSONObject;
use super::symbol::Symbol;

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct AssetId(pub NonZeroU32);

/// The source code for an asset.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCode {
  inner: String,
}

impl SourceCode {
  pub fn bytes(&self) -> &[u8] {
    self.inner.as_bytes()
  }
}

impl From<String> for SourceCode {
  fn from(value: String) -> Self {
    Self { inner: value }
  }
}

/// An asset is a file or part of a file that may represent any data type including source code, binary data, etc.
///
/// Note that assets may exist in the file system or virtually.
///
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  /// The file type of the asset, which may change during transformation
  #[serde(rename = "type")]
  pub asset_type: FileType,

  /// Controls which bundle the asset is placed into
  bundle_behavior: BundleBehavior,

  /// The environment of the asset
  pub env: Environment,

  /// The file path to the asset
  file_path: PathBuf,

  /// The source code of this asset once it's loaded
  code: Option<Rc<SourceCode>>,

  /// The dependencies of this asset
  dependencies: Vec<Dependency>,

  /// Indicates if the asset is used as a bundle entry
  ///
  /// This controls whether a bundle can be split into multiple, or whether all of the
  /// dependencies must be placed in a single bundle.
  ///
  is_bundle_splittable: bool,

  /// Whether this asset is part of the project, and not an external dependency
  ///
  /// This indicates that transformation using the project configuration should be applied.
  ///
  is_source: bool,

  /// Plugin specific metadata for the asset
  pub meta: JSONObject,

  /// The pipeline defined in .parcelrc that the asset should be processed with
  pipeline: Option<String>,

  /// The transformer options for the asset from the dependency query string
  query: Option<String>,

  /// Whether this asset can be omitted if none of its exports are being used
  ///
  /// This is initially set by the resolver, but can be overridden by transformers.
  ///
  side_effects: bool,

  /// Statistics about the asset
  stats: AssetStats,

  /// The symbols that the asset exports
  pub symbols: Vec<Symbol>,

  /// A unique key that identifies an asset
  ///
  /// When a transformer returns multiple assets, it can give them unique keys to identify them.
  /// This can be used to find assets during packaging, or to create dependencies between multiple
  /// assets returned by a transformer by using the unique key as the dependency specifier.
  ///
  pub unique_key: Option<String>,
}

impl Asset {
  pub fn id(&self) -> u64 {
    let mut hasher = AHasher::default();

    self.asset_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.file_path.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.query.hash(&mut hasher);
    self.unique_key.hash(&mut hasher);

    hasher.finish()
  }

  pub fn file_path(&self) -> &Path {
    &self.file_path
  }

  pub fn source_code(&mut self, fs: FileSystemRef) -> anyhow::Result<Rc<SourceCode>> {
    if let Some(source_code) = self.code.clone() {
      Ok(source_code)
    } else {
      let code = fs.read_to_string(&self.file_path)?;
      self.code = Some(Rc::new(SourceCode::from(code)));
      Ok(self.code.clone().unwrap())
    }
  }
}

/// Statistics that pertain to an asset
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AssetStats {
  size: u32,
  time: u32,
}
