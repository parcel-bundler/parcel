use std::ops::Deref;

use crate::{atomics::AtomicVec, string_arena::StringArena};
use bitflags::bitflags;
use dashmap::DashMap;

#[derive(Default)]
pub struct ParcelDb {
  files: StringArena,
  environments: AtomicVec<Environment>,
  dependencies: AtomicVec<Dependency>,
  assets: AtomicVec<Asset>,
  assets_by_file_path: DashMap<u32, usize>,
}

struct FileId(u32);

impl ParcelDb {
  pub fn file_id(&self, name: &str) -> u32 {
    self.files.intern(name)
  }

  pub fn file_name(&self, file_id: u32) -> &str {
    self.files.lookup(file_id)
  }

  pub fn environment_id(&self, env: Environment) -> usize {
    // There probably aren't that many environments, so linear search is fine.
    // if let Some((index, _)) = self.environments.iter().find(|(_, e)| **e == env) {
    //   index.into_raw_parts().0 as u32
    // } else {
    // println!("Create environment {:?}", env);
    self.environments.push(env)
    // }
  }

  pub fn environment(&self, id: usize) -> impl Deref<Target = Environment> + '_ {
    self.environments.get(id).unwrap()
  }

  pub fn create_dependency(&self, dependency: Dependency) -> usize {
    // println!("Create dependency {:?}", dependency);
    self.dependencies.push(dependency)
  }

  pub fn dependency(&self, id: usize) -> impl Deref<Target = Dependency> + '_ {
    self.dependencies.get(id).unwrap()
  }

  pub fn create_asset(&self, asset: Asset) -> usize {
    let file_id = asset.file_id;
    if let Some(existing) = self.assets_by_file_path.get(&file_id) {
      return *existing;
    }
    let id = self.assets.push(asset);
    self.assets_by_file_path.insert(file_id, id);
    id
  }

  pub fn asset(&self, id: usize) -> impl Deref<Target = Asset> + '_ {
    self.assets.get(id).unwrap()
  }
}

#[derive(PartialEq, Debug)]
pub struct SourceLocation {
  file_id: u32,
  start: Location,
  end: Location,
}

#[derive(PartialEq, Debug)]
pub struct Location {
  line: u32,
  column: u32,
}

pub struct Target {
  env_id: u32,
  dist_dir: u32,
  dist_entry: Option<String>,
  name: String,
  public_url: String,
  loc: Option<SourceLocation>,
  // pipeline: Option<String>,
  // source: Option<u32>
}

#[derive(PartialEq, Debug)]
pub struct Environment {
  pub context: EnvironmentContext,
  pub output_format: OutputFormat,
  pub source_type: SourceType,
  pub flags: EnvironmentFlags,
  // source_map
  pub loc: Option<SourceLocation>,
}

pub enum IncludeNodeModules {
  Bool(bool),
  // Include()
}

bitflags! {
  pub struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum EnvironmentContext {
  Browser,
  WebWorker,
  ServiceWorker,
  Worklet,
  Node,
  ElectronMain,
  ElectronRenderer,
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum OutputFormat {
  Global,
  CommonJs,
  EsModule,
}

#[derive(Debug)]
pub struct Asset {
  pub file_id: u32,
  pub env_id: usize,
  // pub content_key: String, // TODO: number
  // pub map_key: Option<String>,
  // pub output_hash: String,
  // meta??
  pub stats: AssetStats,
  // symbols
  // pub unique_key: u64,
  pub asset_type: AssetType,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
}

impl Asset {
  pub fn is_source(&self) -> bool {
    self.flags.contains(AssetFlags::IS_SOURCE)
  }

  pub fn side_effects(&self) -> bool {
    self.flags.contains(AssetFlags::SIDE_EFFECTS)
  }

  pub fn is_bundle_splittable(&self) -> bool {
    self.flags.contains(AssetFlags::IS_BUNDLE_SPLITTABLE)
  }
}

#[derive(Debug)]
pub enum AssetType {
  Js,
  Css,
  Html,
  Other,
}

#[derive(Debug, Clone, Copy)]
pub enum BundleBehavior {
  None,
  Inline,
  Isolated,
}

#[derive(Debug, Default)]
pub struct AssetStats {
  size: u32,
  time: u32,
}

bitflags! {
  pub struct AssetFlags: u8 {
    const IS_SOURCE = 0b00000001;
    const SIDE_EFFECTS = 0b00000010;
    const IS_BUNDLE_SPLITTABLE = 0b00000100;
  }
}

#[derive(Debug)]
pub struct Dependency {
  pub asset_id: Option<usize>,
  pub env_id: usize,
  pub specifier: String,
  pub specifier_type: SpecifierType,
  pub resolve_from: Option<u32>,
  pub priority: Priority,
  pub bundle_behavior: BundleBehavior,
  pub flags: DependencyFlags,
  pub loc: Option<SourceLocation>,
  // meta/resolver_meta/target
  // symbols
  // range
  // pipeline
}

bitflags! {
  pub struct DependencyFlags: u8 {
    const ENTRY    = 0b00000001;
    const OPTIONAL = 0b00000010;
    const NEEDS_STABLE_NAME = 0b00000100;
  }
}

#[derive(Clone, Copy, Debug)]
pub enum SpecifierType {
  Esm,
  CommonJs,
  Url,
  Custom,
}

#[derive(Clone, Copy, Debug)]
pub enum Priority {
  Sync,
  Parallel,
  Lazy,
}

pub enum AssetGraphNode {
  Asset(usize),
  Dependency(usize),
}
