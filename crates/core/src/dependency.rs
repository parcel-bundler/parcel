use std::{
  hash::{DefaultHasher, Hash, Hasher},
  sync::Arc,
};

use crate::{AssetType, BundleBehavior, SourceUrl, Target};
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
  pub target: Arc<Target>,
  #[serde(default)]
  pub loc: Option<SourceLocation>,
  #[serde(default)]
  pub placeholder: Option<String>,
  pub resolve_from: Option<SourceUrl>,
  pub range: Option<String>,
  pub conditions: ExportsCondition,
  pub resolution: DependencyResolution,
}

impl Dependency {
  pub fn set_placeholder(&mut self) -> &str {
    let mut hasher = DefaultHasher::new();
    self.specifier.hash(&mut hasher);
    self.specifier_type.hash(&mut hasher);
    self.flags.hash(&mut hasher);
    self.priority.hash(&mut hasher);
    self.target.output_format.hash(&mut hasher);
    self.target.source_type.hash(&mut hasher);
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

bitflags::bitflags! {
  /// A package.json "exports" field.
  #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
  pub struct ExportsCondition: u32 {
    /// The "import" condition. True when the package was referenced using the ESM `import` syntax.
    const IMPORT = 1 << 0;
    /// The "require" condition. True when the package was referenced using the CommonJS `require` function.
    const REQUIRE = 1 << 1;
    /// The "module" condition. True when the package was referenced from either the ESM `import` syntax or the CommonJS `require` function/
    const MODULE = 1 << 2;
    /// The "node" condition. True when the module will run in a Node environment.
    const NODE = 1 << 3;
    /// The "browser" condition. True when the module will run in a browser environment.
    const BROWSER = 1 << 4;
    /// The "worker" condition. True when the module will run in a web worker or service worker environment.
    const WORKER = 1 << 5;
    /// The "worklet" condition. True when the module will run in a worklet environment.
    const WORKLET = 1 << 6;
    /// The "electron" condition. True when the module will run in an Electron environment.
    const ELECTRON = 1 << 7;
    /// The "development" condition. True when the module will run in a development environment.
    const DEVELOPMENT = 1 << 8;
    /// The "production" condition. True when the module will run in a production environment.
    const PRODUCTION = 1 << 9;
    /// The "types" condition. True when loading TypeScript types.
    const TYPES = 1 << 10;
    /// The "default" condition when no other conditions matched.
    const DEFAULT = 1 << 11;
    /// The "style" condition. True when the package was referenced from a stylesheet (e.g. CSS, Sass, Stylus, etc.).
    const STYLE = 1 << 12;
    /// The "sass" condition. True when the package was referenced from a Sass stylesheet.
    const SASS = 1 << 13;
    /// The "less" condition. True when the package was referenced from a Less stylesheet.
    const LESS = 1 << 14;
    /// The "stylus" condition. True when the package was referenced from a Stylus stylesheet.
    const STYLUS = 1 << 15;
    /// The "react-server" condition.
    const REACT_SERVER = 1 << 16;
    /// The "source" condition.
    const SOURCE = 1 << 17;
  }
}

impl_bitflags_serde!(ExportsCondition);

impl Default for ExportsCondition {
  fn default() -> Self {
    ExportsCondition::empty()
  }
}

impl TryFrom<&str> for ExportsCondition {
  type Error = ();
  fn try_from(value: &str) -> Result<Self, Self::Error> {
    Ok(match value {
      "import" => ExportsCondition::IMPORT,
      "require" => ExportsCondition::REQUIRE,
      "module" => ExportsCondition::MODULE,
      "node" => ExportsCondition::NODE,
      "browser" => ExportsCondition::BROWSER,
      "worker" => ExportsCondition::WORKER,
      "worklet" => ExportsCondition::WORKLET,
      "electron" => ExportsCondition::ELECTRON,
      "development" => ExportsCondition::DEVELOPMENT,
      "production" => ExportsCondition::PRODUCTION,
      "types" => ExportsCondition::TYPES,
      "default" => ExportsCondition::DEFAULT,
      "style" => ExportsCondition::STYLE,
      "sass" => ExportsCondition::SASS,
      "less" => ExportsCondition::LESS,
      "stylus" => ExportsCondition::STYLUS,
      "react-server" => ExportsCondition::REACT_SERVER,
      "source" => ExportsCondition::SOURCE,
      _ => return Err(()),
    })
  }
}

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
  pub target: Arc<Target>,
  pub code: Option<Vec<u8>>,
  pub side_effects: bool,
}
