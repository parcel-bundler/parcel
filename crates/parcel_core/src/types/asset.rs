use bitflags::bitflags;
use std::hash::{Hash, Hasher};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;

use crate::impl_bitflags_serde;
use serde::Deserialize;
use serde::Serialize;

use crate::types::EnvironmentContext;

use super::bundle::BundleBehavior;
use super::environment::Environment;
use super::file_type::FileType;
use super::json::JSONObject;
use super::symbol::Symbol;

#[derive(PartialEq, Hash, Clone, Copy, Debug)]
pub struct AssetId(pub NonZeroU32);

/// The source code for an asset.
#[derive(PartialEq, Default, Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Code {
  inner: String,
}

impl Code {
  pub fn bytes(&self) -> &[u8] {
    self.inner.as_bytes()
  }

  pub fn size(&self) -> u32 {
    self.inner.len() as u32
  }
}

impl From<String> for Code {
  fn from(value: String) -> Self {
    Self { inner: value }
  }
}

/// An asset is a file or part of a file that may represent any data type including source code, binary data, etc.
///
/// Note that assets may exist in the file system or virtually.
///
#[derive(Default, PartialEq, Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  /// The file type of the asset, which may change during transformation
  #[serde(rename = "type")]
  pub asset_type: FileType,

  /// Controls which bundle the asset is placed into
  pub bundle_behavior: BundleBehavior,

  /// The environment of the asset
  pub env: Arc<Environment>,

  /// The file path to the asset
  pub file_path: PathBuf,

  /// The code of this asset, initially read from disk, then becoming the
  /// transformed output
  pub code: Rc<Code>,

  /// Indicates if the asset is used as a bundle entry
  ///
  /// This controls whether a bundle can be split into multiple, or whether all of the
  /// dependencies must be placed in a single bundle.
  ///
  pub is_bundle_splittable: bool,

  /// Whether this asset is part of the project, and not an external dependency
  ///
  /// This indicates that transformation using the project configuration should be applied.
  ///
  pub is_source: bool,

  /// Plugin specific metadata for the asset
  pub meta: JSONObject,

  /// The pipeline defined in .parcelrc that the asset should be processed with
  pub pipeline: Option<String>,

  /// The transformer options for the asset from the dependency query string
  pub query: Option<String>,

  /// Whether this asset can be omitted if none of its exports are being used
  ///
  /// This is initially set by the resolver, but can be overridden by transformers.
  ///
  pub side_effects: bool,

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
  /// TODO: Make this non-nullable and disallow creating assets without it.
  pub unique_key: Option<String>,

  /// A collection of boolean properties related to this asset.
  ///
  /// TODO: we might inline these
  pub flags: AssetFlags,
}

impl Asset {
  pub fn id(&self) -> u64 {
    let mut hasher = crate::hash::IdentifierHasher::default();

    self.asset_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    self.file_path.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.query.hash(&mut hasher);
    self.unique_key.hash(&mut hasher);

    hasher.finish()
  }

  /// Build a new empty asset
  pub fn new_empty(file_path: PathBuf, source_code: Rc<Code>) -> Self {
    let asset_type =
      FileType::from_extension(file_path.extension().and_then(|s| s.to_str()).unwrap_or(""));

    // TODO: rest of this
    Self {
      file_path,
      asset_type,
      env: Arc::new(Environment {
        context: EnvironmentContext::Browser,
        ..Default::default()
      }),
      code: source_code,
      ..Default::default()
    }
  }

  pub fn set_interpreter(&mut self, shebang: impl Into<serde_json::Value>) {
    self.meta.insert("interpreter".into(), shebang.into());
  }
}

// TODO: All of these should have documentation
bitflags! {
  #[derive(Debug, Clone, Copy, Default, PartialEq)]
  pub struct AssetFlags: u32 {
    const IS_SOURCE = 1 << 0;
    // replaced with `Asset::side_effects` for now
    // const SIDE_EFFECTS = 1 << 1;
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

impl_bitflags_serde!(AssetFlags);

/// Statistics that pertain to an asset
#[derive(PartialEq, Clone, Debug, Default, Deserialize, Serialize)]
pub struct AssetStats {
  pub size: u32,
  pub time: u32,
}
