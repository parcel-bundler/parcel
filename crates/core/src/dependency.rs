use std::{
  hash::{DefaultHasher, Hash, Hasher},
  sync::Arc,
};

use crate::{AssetType, BundleBehavior, SourceUrl, environment::Environment};
use crate::{SourceLocation, impl_bitflags_serde};
use bitflags::bitflags;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub env: Arc<Environment>,
  #[serde(default)]
  pub loc: Option<SourceLocation>,
  #[serde(default)]
  pub placeholder: Option<String>,
  pub resolve_from: Option<SourceUrl>,
  pub range: Option<String>,
  pub resolution: DependencyResolution,
}

impl Dependency {
  pub fn set_placeholder(&mut self) -> &str {
    let mut hasher = DefaultHasher::new();
    self.specifier.hash(&mut hasher);
    self.specifier_type.hash(&mut hasher);
    self.flags.hash(&mut hasher);
    self.priority.hash(&mut hasher);
    self.env.output_format.hash(&mut hasher);
    self.env.source_type.hash(&mut hasher);
    self.bundle_behavior.hash(&mut hasher);
    self.placeholder = Some(format!("{:x}", hasher.finish()));
    self.placeholder.as_ref().unwrap()
  }
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpecifierType {
  #[default]
  Esm,
  Commonjs,
  Url,
  Custom,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
  #[default]
  Sync,
  Parallel,
  Lazy,
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct DependencyFlags: u8 {
    const ENTRY    = 1 << 0;
    const OPTIONAL = 1 << 1;
    const NEEDS_STABLE_NAME = 1 << 2;
    const SHOULD_WRAP = 1 << 3;
    const IS_ESM = 1 << 4;
    const IS_WEBWORKER = 1 << 5;
    const HAS_SYMBOLS = 1 << 6;
    const SIDE_EFFECTS = 1 << 7;
  }
}

impl_bitflags_serde!(DependencyFlags);

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DependencyResolution {
  #[default]
  None,
  Deferred(Arc<AssetRequest>),
  External,
  Excluded,
  Asset(u32),
  Bundle(u32),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetRequest {
  pub url: SourceUrl,
  pub ty: AssetType,
  pub pipeline: Option<hstr::Atom>,
  pub env: Arc<Environment>,
  pub code: Option<Vec<u8>>,
  pub side_effects: bool,
}
