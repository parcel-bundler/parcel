use std::collections::hash_map::DefaultHasher;
use std::path::PathBuf;

use parcel_resolver::ExportsCondition;
use serde::Deserialize;
use serde::Serialize;

use super::dependency_flags::DependencyFlags;
use super::import_attribute::ImportAttribute;
use super::BundleBehavior;
use super::JSONObject;
use super::Priority;
use super::SourceLocation;
use super::SpecifierType;
use super::Symbol;
use super::Target;
use crate::environment::Environment;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
  // pub id: String,
  pub source_asset_id: Option<String>,
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub source_path: Option<PathBuf>,
  pub env: Environment,
  pub resolve_from: Option<PathBuf>,
  pub range: Option<String>,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  #[serde(default)]
  pub loc: Option<SourceLocation>,
  #[serde(default)]
  pub placeholder: Option<String>,
  #[serde(default)]
  pub target: Option<Box<Target>>,
  #[serde(default)]
  pub symbols: Vec<Symbol>,
  #[serde(default)]
  pub promise_symbol: Option<String>,
  #[serde(default)]
  pub import_attributes: Vec<ImportAttribute>,
  #[serde(default)]
  pub pipeline: Option<String>,
  #[serde(default)]
  pub meta: JSONObject,
  #[serde(default)]
  pub resolver_meta: JSONObject,
  #[serde(default)]
  pub package_conditions: ExportsCondition,
  #[serde(default)]
  pub custom_package_conditions: Vec<String>,
}

impl Dependency {
  pub fn new(specifier: String, env: Environment) -> Dependency {
    Dependency {
      // id: String::default(),
      source_asset_id: None,
      specifier,
      specifier_type: SpecifierType::Esm,
      source_path: None, //Some(source_asset.id),
      env,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: DependencyFlags::empty(),
      resolve_from: None,
      range: None,
      loc: None,
      placeholder: None,
      target: None,
      symbols: Vec::new(),
      promise_symbol: None,
      import_attributes: Vec::new(),
      pipeline: None,
      meta: JSONObject::new(),
      resolver_meta: JSONObject::new(),
      package_conditions: ExportsCondition::empty(),
      custom_package_conditions: Vec::new(),
    }
  }

  pub fn id(&self) -> u64 {
    // Compute hashed dependency id.
    use std::hash::Hash;
    use std::hash::Hasher;
    let mut hasher = DefaultHasher::new();
    self.source_path.hash(&mut hasher);
    self.specifier.hash(&mut hasher);
    self.specifier_type.hash(&mut hasher);
    self.env.hash(&mut hasher);
    // self.target.hash(&mut hasher);
    self.pipeline.hash(&mut hasher);
    self.bundle_behavior.hash(&mut hasher);
    self.priority.hash(&mut hasher);
    self.package_conditions.hash(&mut hasher);
    self.custom_package_conditions.hash(&mut hasher);
    hasher.finish()
  }

  // pub fn commit(mut self) -> u32 {
  //   self.id = format!("{:016x}", self.get_id_hash()).into();
  //   self.into_arena()
  // }
}
