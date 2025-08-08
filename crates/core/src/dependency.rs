use std::{
  hash::{DefaultHasher, Hash, Hasher},
  path::{Path, PathBuf},
  sync::Arc,
};

use crate::{BundleBehavior, environment::Environment};
use crate::{SourceLocation, impl_bitflags_serde};
use bitflags::bitflags;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  pub specifier: Box<str>,
  pub specifier_type: SpecifierType,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub env: Arc<Environment>,
  #[serde(default)]
  pub loc: Option<SourceLocation>,
  #[serde(default)]
  pub placeholder: Option<Box<str>>,
  pub resolve_from: Option<Box<str>>,
  pub range: Option<Box<str>>,

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
    self.placeholder = Some(format!("{:x}", hasher.finish()).into_boxed_str());
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
  #[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
  pub struct DependencyFlags: u8 {
    const OPTIONAL = 1 << 0;
    const NEEDS_STABLE_NAME = 1 << 1;
    const IS_HELPER = 1 << 2;
    const IS_ESM = 1 << 3;
    const IS_WEBWORKER = 1 << 4;
    const REACT_LAZY = 1 << 5;
    const PRELOAD = 1 << 6;
    const PREFETCH = 1 << 7;
  }
}

impl_bitflags_serde!(DependencyFlags);

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DependencyResolution {
  #[default]
  New,
  Deferred(Box<AssetRequest>),
  External,
  Excluded,
  Asset(u32),
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetRequest {
  pub url: Box<str>,
  pub code: Option<Box<[u8]>>,
  pub pipeline: Option<Box<str>>,
  pub side_effects: bool,
}
