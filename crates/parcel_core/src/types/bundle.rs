use serde::Deserialize;
use serde::Serialize;
use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

use super::environment::Environment;
use super::file_type::FileType;
use super::target::Target;

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
  /// Controls the behavior of the bundle to determine when the bundle loads
  pub bundle_behavior: BundleBehavior,

  /// The type of the bundle
  #[serde(rename = "type")]
  pub bundle_type: FileType,

  /// The list of assets executed immediately when the bundle is loaded
  ///
  /// Some bundles may not have any entry assets, like shared bundles.
  ///
  pub entry_asset_ids: Vec<String>,

  /// The environment of the bundle
  pub env: Environment,

  /// A placeholder for the bundle content hash
  ///
  /// It can be used in the bundle's name or the contents of another bundle. Hash references are replaced
  /// with a content hash of the bundle after packaging and optimizing.
  ///
  pub hash_reference: String,

  /// The bundle id
  pub id: String,

  /// Whether the bundle can be split
  ///
  /// If false, then all dependencies of the bundle will be kept internal to the bundle, rather
  /// than referring to other bundles. This may result in assets being duplicated between
  /// multiple bundles, but can be useful for things like server side rendering.
  ///
  pub is_splittable: bool,

  /// The main entry of the bundle, which will provide the bundle exports
  ///
  /// Some bundles, such as shared bundles, may not have a main entry.
  ///
  pub main_entry_id: Option<String>,

  pub manual_shared_bundle: Option<String>,

  /// The name of the bundle, which is a file path relative to the bundle target directory
  ///
  /// The bundle name may include a hash reference, but not the final content hash.
  ///
  pub name: Option<String>,

  /// Indicates that the name should be stable over time, even when the content of the bundle changes
  pub needs_stable_name: bool,

  /// The pipeline associated with the bundle
  pub pipeline: Option<String>,

  /// A shortened version of the bundle id that is used to refer to the bundle at runtime
  pub public_id: Option<String>,

  /// The output target for the bundle
  pub target: Target,
}

/// Determines when the bundle loads
#[derive(
  Clone,
  Copy,
  Debug,
  Deserialize_repr,
  Eq,
  Hash,
  PartialEq,
  Serialize_repr,
  rkyv::Archive,
  rkyv::Serialize,
  rkyv::Deserialize,
  bincode::Encode,
  bincode::Decode,
)]
#[repr(u8)]
#[archive(check_bytes)]
pub enum BundleBehavior {
  /// Embeds an asset into the parent bundle by creating an inline bundle
  Inline = 0,

  /// The asset will be isolated from its parents in a separate bundle, and shared assets will be duplicated
  Isolated = 1,

  /// Unspecified bundling behavior
  None = 255,
}

impl Default for BundleBehavior {
  fn default() -> Self {
    BundleBehavior::None
  }
}
