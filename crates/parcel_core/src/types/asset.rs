use std::hash::Hash;
use std::hash::Hasher;
use std::num::NonZeroU32;
use std::path::PathBuf;

use bitflags::bitflags;
use gxhash::GxHasher;
use serde::Deserialize;
use serde::Serialize;

use super::bundle::BundleBehavior;
use super::environment::Environment;
use super::file_type::FileType;
use super::json::JSONObject;
use super::symbol::Symbol;
use crate::bitflags_serde;

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct AssetId(pub NonZeroU32);

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
  pub bundle_behavior: BundleBehavior,

  /// The environment of the asset
  pub env: Environment,

  /// Togglable options that represent the state of the asset
  pub flags: AssetFlags,

  /// The file path to the asset
  pub file_path: PathBuf,

  /// Plugin specific metadata for the asset
  pub meta: JSONObject,

  /// The pipeline defined in .parcelrc that the asset should be processed with
  pub pipeline: Option<String>,

  /// The transformer options for the asset from the dependency query string
  pub query: Option<String>,

  /// Statistics about the asset
  pub stats: AssetStats,

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
    let mut hasher = GxHasher::default();

    self.asset_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.file_path.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.query.hash(&mut hasher);
    self.unique_key.hash(&mut hasher);

    hasher.finish()
  }
}

bitflags! {
  #[derive(Debug, Clone, Copy, PartialEq)]
  pub struct AssetFlags: u32 {
    const IS_SOURCE = 1 << 0;
    const SIDE_EFFECTS = 1 << 1;
    const IS_BUNDLE_SPLITTABLE = 1 << 2;
    const LARGE_BLOB = 1 << 3;
    const HAS_CJS_EXPORTS = 1 << 4;
    const STATIC_EXPORTS = 1 << 5;
    const SHOULD_WRAP = 1 << 6;
    const IS_CONSTANT_MODULE = 1 << 7;
    const HAS_NODE_REPLACEMENTS = 1 << 8;
    const HAS_SYMBOLS = 1 << 9;
  }
}

bitflags_serde!(AssetFlags);

/// Statistics that pertain to an asset
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AssetStats {
  pub size: u32,
  pub time: u32,
}
