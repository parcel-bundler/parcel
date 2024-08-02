use core::panic;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde::Serialize;
use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

use crate::types::ExportsCondition;

use super::bundle::BundleBehavior;
use super::environment::Environment;
use super::json::JSONObject;
use super::source::SourceLocation;
use super::symbol::Symbol;
use super::target::Target;

/// A dependency denotes a connection between two assets
#[derive(PartialEq, Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  /// Controls the behavior of the bundle the resolved asset is placed into
  ///
  /// This option is used in combination with priority to determine when the bundle is loaded.
  ///
  pub bundle_behavior: BundleBehavior,

  /// The environment of the dependency
  pub env: Arc<Environment>,

  /// The location within the source file where the dependency was found
  #[serde(default)]
  pub loc: Option<SourceLocation>,

  /// Plugin-specific metadata for the dependency
  #[serde(default)]
  pub meta: JSONObject,

  /// A list of custom conditions to use when resolving package.json "exports" and "imports"
  ///
  /// This will be combined with the conditions from the environment. However, it overrides the default "import" and "require" conditions inferred from the specifierType. To include those in addition to custom conditions, explicitly add them to this list.
  ///
  #[serde(default)]
  pub package_conditions: ExportsCondition,

  /// The pipeline defined in .parcelrc that the dependency should be processed with
  #[serde(default)]
  pub pipeline: Option<String>,

  /// Determines when the dependency should be loaded
  pub priority: Priority,

  /// The semver version range expected for the dependency
  pub range: Option<String>,

  /// The file path where the dependency should be resolved from
  ///
  /// By default, this is the path of the source file where the dependency was specified.
  ///
  pub resolve_from: Option<PathBuf>,

  /// The id of the asset with this dependency
  pub source_asset_id: Option<String>,

  /// The file path of the asset with this dependency
  pub source_path: Option<PathBuf>,

  /// The import or export specifier that connects two assets together
  pub specifier: String,

  /// How the specifier should be interpreted
  pub specifier_type: SpecifierType,

  /// These are the "Symbols" this dependency has which are used in import sites.
  ///
  /// We might want to split this information from this type.
  #[serde(default)]
  pub symbols: Vec<Symbol>,

  /// The target associated with an entry, if any
  #[serde(default)]
  pub target: Option<Box<Target>>,

  /// Whether the dependency is an entry
  pub is_entry: bool,

  /// Whether the dependency is optional
  ///
  /// If an optional dependency cannot be resolved, it will not fail the build.
  ///
  pub is_optional: bool,

  /// Indicates that the name should be stable over time, even when the content of the bundle changes
  ///
  /// When the dependency is a bundle entry (priority is "parallel" or "lazy"), this controls the
  /// naming of that bundle.
  ///
  /// This is useful for entries that a user would manually enter the URL for, as well as for
  /// things like service workers or RSS feeds, where the URL must remain consistent over time.
  ///
  pub needs_stable_name: bool,

  pub should_wrap: bool,

  /// Whether this dependency object corresponds to an ESM import/export statement or to a dynamic
  /// import expression.
  pub is_esm: bool,

  /// Whether the symbols vector of this dependency has had symbols added to it.
  pub has_symbols: bool,

  pub placeholder: Option<String>,
}

impl Dependency {
  pub fn entry(entry: String, target: Target) -> Dependency {
    let is_library = target.env.is_library;
    let mut symbols = Vec::new();

    if is_library {
      symbols.push(Symbol {
        exported: "*".into(),
        is_esm_export: false,
        is_weak: true,
        loc: None,
        local: "*".into(),
        self_referenced: false,
      });
    }

    Dependency {
      env: target.env.clone(),
      has_symbols: is_library,
      is_entry: true,
      needs_stable_name: true,
      specifier: entry,
      specifier_type: SpecifierType::Url,
      symbols,
      target: Some(Box::new(target)),
      ..Dependency::default()
    }
  }

  pub fn new(specifier: String, env: Arc<Environment>) -> Dependency {
    Dependency {
      env,
      meta: JSONObject::new(),
      specifier,
      ..Dependency::default()
    }
  }

  pub fn id(&self) -> u64 {
    let mut hasher = crate::hash::IdentifierHasher::default();
    self.hash(&mut hasher);
    hasher.finish()
  }

  pub fn set_placeholder(&mut self, placeholder: impl Into<serde_json::Value>) {
    self.meta.insert("placeholder".into(), placeholder.into());
  }

  pub fn set_is_webworker(&mut self) {
    self.meta.insert("webworker".into(), true.into());
  }

  pub fn set_kind(&mut self, kind: impl Into<serde_json::Value>) {
    self.meta.insert("kind".into(), kind.into());
  }

  pub fn set_should_wrap(&mut self, should_wrap: bool) {
    self.meta.insert("shouldWrap".into(), should_wrap.into());
    self.should_wrap = should_wrap;
  }

  pub fn set_add_import_attibute(&mut self, attribute: impl Into<String>) {
    let object = self
      .meta
      .entry(String::from("importAttributes"))
      .or_insert(serde_json::Map::new().into());

    if let serde_json::Value::Object(import_attributes) = object {
      import_attributes.insert(attribute.into(), true.into());
    } else {
      panic!("Dependency import attributes invalid. This should never happen");
    }
  }
}

impl Hash for Dependency {
  fn hash<H: Hasher>(&self, state: &mut H) {
    self.bundle_behavior.hash(state);
    self.env.hash(state);
    self.package_conditions.hash(state);
    self.pipeline.hash(state);
    self.priority.hash(state);
    self.source_path.hash(state);
    self.specifier.hash(state);
    self.specifier_type.hash(state);
  }
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct ImportAttribute {
  pub key: String,
  pub value: bool,
}

/// Determines when a dependency should load
#[derive(Clone, Copy, Debug, Deserialize_repr, Eq, Hash, PartialEq, Serialize_repr)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Priority {
  /// Resolves the dependency synchronously, placing the resolved asset in the same bundle as the parent or another bundle that is already on the page
  Sync = 0,
  /// Places the dependency in a separate bundle loaded in parallel with the current bundle
  Parallel = 1,
  /// The dependency should be placed in a separate bundle that is loaded later
  Lazy = 2,
}

impl Default for Priority {
  fn default() -> Self {
    Priority::Sync
  }
}

/// The type of the import specifier
#[derive(Clone, Copy, Debug, Deserialize_repr, Eq, Hash, PartialEq, Serialize_repr)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum SpecifierType {
  /// An ES Module specifier
  ///
  /// This is parsed as an URL, but bare specifiers are treated as node_modules.
  ///
  Esm = 0,

  /// A CommonJS specifier
  ///
  /// This is not parsed as an URL.
  ///
  CommonJS = 1,

  /// A URL that works as in a browser
  ///
  /// Bare specifiers are treated as relative URLs.
  ///
  Url = 2,

  /// A custom specifier that must be handled by a custom resolver plugin
  Custom = 3,
}

impl Default for SpecifierType {
  fn default() -> Self {
    SpecifierType::Esm
  }
}
