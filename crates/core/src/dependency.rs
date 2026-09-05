use std::{
  hash::{DefaultHasher, Hash, Hasher},
  sync::Arc,
};

use crate::{AssetNodeIndex, AssetType, BundleBehavior, Content, SourceUrl, Target};
use crate::{SourceLocation, impl_bitflags_serde};
use bitflags::bitflags;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  pub specifier: Box<str>,
  /// How the specifier is interpreted during resolution.
  pub specifier_type: SpecifierType,
  /// When the dependency is loaded.
  pub priority: Priority,
  /// Which bundle the resolved asset is placed into.
  pub bundle_behavior: BundleBehavior,
  /// How the resolved asset is evaluated (i.e. the value it exports).
  pub import_type: ImportType,
  pub flags: DependencyFlags,
  pub target: Arc<Target>,
  #[serde(default)]
  pub loc: Option<SourceLocation>,
  #[serde(default)]
  pub placeholder: Option<Box<str>>,
  pub resolve_from: Option<SourceUrl>,
  pub range: Option<Box<str>>,
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
    self.import_type.hash(&mut hasher);
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
  #[derive(Debug, Clone, Copy, Hash)]
  pub struct DependencyFlags: u8 {
    const ENTRY    = 1 << 0;
    const OPTIONAL = 1 << 1;
    const NEEDS_STABLE_NAME = 1 << 2;
    const IS_WEBWORKER = 1 << 3;
    const SIDE_EFFECTS = 1 << 4;
    const MACRO = 1 << 5;
    const REACT_LAZY = 1 << 6;
    /// Resolve this dependency from node_modules even when the target normally externalizes it.
    /// This only applies to the current dependency edge. The resolved asset retains the original
    /// target so its dependencies continue to follow the target's normal externalization policy.
    const FORCE_BUNDLE = 1 << 7;
  }
}

impl_bitflags_serde!(DependencyFlags);

/// Describes how a dependency is evaluated. This can be changed via import attributes.
///
/// NOTE: This does NOT change how a module is _transformed_, only what the import evaluates to.
/// For example, importing a JS file with {type: 'text'} evaluates to a string of the compiled
/// bundle contents, not the original source code. If you want the original source code, you can
/// configure a named pipeline in `.parcelrc` to remove all transformers.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
pub enum ImportType {
  /// Evaluate the imported module as JavaScript, resolving to its exports.
  /// This is also used in the case of JSON or other serialization formats.
  JavaScript,
  /// Resolve to a CSSStyleSheet object.
  /// https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-css-module-script
  StyleSheet,
  /// Resolve to a URL string.
  /// If the dependency has BundleBehavior::Inline, this resolves to a data URL, otherwise a bundle URL.
  Url,
  /// Resolve to a string of a bundle's content.
  /// https://github.com/tc39/proposal-import-text
  Text,
  /// Resolve to a Uint8Array of a bundle's content.
  /// https://github.com/tc39/proposal-import-bytes
  Bytes,
}

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

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub enum DependencyResolution {
  #[default]
  None,
  Deferred(Arc<AssetRequest>),
  External,
  Excluded,
  Asset(AssetNodeIndex),
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetRequest {
  pub loc: SourceLocation,
  pub ty: AssetType,
  pub pipeline: Option<hstr::Atom>,
  pub target: Arc<Target>,
  pub content: Arc<dyn Content>,
  pub side_effects: bool,
  /// Discriminator for multiple inline assets emitted at the same source location
  /// (e.g. inline scripts/styles on one HTML line, or multiple `addAsset` calls from
  /// one macro invocation). Part of the request's stable identity.
  pub unique_key: Option<Arc<str>>,
}

impl PartialEq for AssetRequest {
  fn eq(&self, other: &Self) -> bool {
    self.loc == other.loc
      && self.ty == other.ty
      && self.pipeline == other.pipeline
      && self.target == other.target
      && self.content.eq(&*other.content)
      && self.side_effects == other.side_effects
      && self.unique_key == other.unique_key
  }
}

impl Eq for AssetRequest {}

/// Stable identity of an asset request: everything except the content. Two requests
/// with the same key refer to the same logical asset (and asset graph node); a content
/// difference between them means that asset needs re-transformation, not that a
/// separate asset exists.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct AssetRequestKey {
  pub loc: SourceLocation,
  pub ty: AssetType,
  pub pipeline: Option<hstr::Atom>,
  pub target: Arc<Target>,
  pub side_effects: bool,
  pub unique_key: Option<Arc<str>>,
}

impl AssetRequest {
  pub fn stable_key(&self) -> AssetRequestKey {
    AssetRequestKey {
      loc: self.loc.clone(),
      ty: self.ty.clone(),
      pipeline: self.pipeline.clone(),
      target: self.target.clone(),
      side_effects: self.side_effects,
      unique_key: self.unique_key.clone(),
    }
  }
}
