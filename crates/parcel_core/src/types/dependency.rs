use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;
use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

use crate::types::ExportsCondition;

use super::bundle::BundleBehavior;
use super::environment::Environment;
use super::source::SourceLocation;
use super::symbol::Symbol;
use super::target::Target;

mod bitflags_archiver {
  use bitflags::Flags;
  use rkyv::primitive::ArchivedU16;
  use rkyv::rancor::Fallible;
  use rkyv::rend::u16_le;
  use rkyv::with::{ArchiveWith, DeserializeWith, SerializeWith};
  use rkyv::{Archive, Serialize, SerializeUnsized};
  use std::error::Error;
  use std::marker::PhantomData;

  pub struct BitFlagsArchiver<T: Flags<Bits = u16>> {
    _phantom: PhantomData<T>,
  }

  impl<T: Flags<Bits = u16>> ArchiveWith<T> for BitFlagsArchiver<T> {
    type Archived = ArchivedU16;
    type Resolver = ();

    #[inline]
    unsafe fn resolve_with(
      field: &T,
      pos: usize,
      resolver: Self::Resolver,
      out: *mut Self::Archived,
    ) {
      let le_value = u16_le::from_native(field.bits());
      ArchivedU16::resolve(&le_value, pos, resolver, out);
    }
  }

  impl<T: Flags<Bits = u16>, S: Fallible + ?Sized> SerializeWith<T, S> for BitFlagsArchiver<T>
  where
    S::Error: Error,
    str: SerializeUnsized<S>,
  {
    #[inline]
    fn serialize_with(field: &T, serializer: &mut S) -> Result<Self::Resolver, S::Error> {
      let le_value = u16_le::from_native(field.bits());
      ArchivedU16::serialize(&le_value, serializer)
    }
  }

  impl<T: Flags<Bits = u16>, D: Fallible + ?Sized> DeserializeWith<ArchivedU16, T, D>
    for BitFlagsArchiver<T>
  {
    #[inline]
    fn deserialize_with(field: &ArchivedU16, _: &mut D) -> Result<T, D::Error> {
      Ok(T::from_bits(field.to_native()).unwrap())
    }
  }
}

#[derive(
  PartialEq,
  Clone,
  Debug,
  Default,
  Deserialize,
  Serialize,
  rkyv::Archive,
  rkyv::Deserialize,
  rkyv::Serialize,
)]
pub struct DependencyMeta {}

/// A dependency denotes a connection between two assets
#[derive(
  PartialEq,
  Clone,
  Debug,
  Default,
  Deserialize,
  Serialize,
  rkyv::Archive,
  rkyv::Deserialize,
  rkyv::Serialize,
)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  /// Controls the behavior of the bundle the resolved asset is placed into
  ///
  /// This option is used in combination with priority to determine when the bundle is loaded.
  ///
  pub bundle_behavior: BundleBehavior,

  /// The environment of the dependency
  pub env: Environment,

  /// The location within the source file where the dependency was found
  #[serde(default)]
  pub loc: Option<SourceLocation>,

  /// Plugin-specific metadata for the dependency
  pub meta: DependencyMeta,

  /// A list of custom conditions to use when resolving package.json "exports" and "imports"
  ///
  /// This will be combined with the conditions from the environment. However, it overrides the default "import" and "require" conditions inferred from the specifierType. To include those in addition to custom conditions, explicitly add them to this list.
  ///
  #[serde(default)]
  #[with(bitflags_archiver::BitFlagsArchiver<ExportsCondition>)]
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
  #[with(rkyv::with::Map<rkyv::with::AsString>)]
  pub resolve_from: Option<PathBuf>,

  /// The id of the asset with this dependency
  pub source_asset_id: Option<String>,

  /// The file path of the asset with this dependency
  #[with(rkyv::with::Map<rkyv::with::AsString>)]
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
}

impl Dependency {
  pub fn new(specifier: String, env: Environment) -> Dependency {
    Dependency {
      bundle_behavior: BundleBehavior::None,
      env,
      loc: None,
      meta: DependencyMeta {},
      package_conditions: ExportsCondition::empty(),
      pipeline: None,
      priority: Priority::default(),
      range: None,
      resolve_from: None,
      source_asset_id: None,
      source_path: None,
      specifier,
      specifier_type: SpecifierType::default(),
      symbols: Vec::new(),
      target: None,
      is_entry: false,
      is_optional: false,
      needs_stable_name: false,
      should_wrap: false,
      has_symbols: false,
      is_esm: false,
    }
  }

  pub fn id(&self) -> u64 {
    let mut hasher = crate::hash::IdentifierHasher::default();
    self.hash(&mut hasher);
    hasher.finish()
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
  rkyv::Deserialize,
  rkyv::Serialize,
)]
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
  rkyv::Deserialize,
  rkyv::Serialize,
)]
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
