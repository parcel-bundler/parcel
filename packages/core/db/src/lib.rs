#![allow(dead_code)]

use std::sync::RwLock;

use bitflags::bitflags;
use generational_arena::{Arena, Index};
use lazy_static::lazy_static;
use napi::Env;
use napi_derive::napi;
use num_derive::FromPrimitive;
use num_traits::FromPrimitive;

mod string_arena;
use string_arena::StringArena;

lazy_static! {
  static ref DB: RwLock<ParcelDb> = RwLock::new(ParcelDb::default());
}

#[napi]
fn file_id(name: String) -> u32 {
  DB.write().unwrap().file_id(&name)
}

#[napi]
fn file_name(env: Env, file_id: u32) -> napi::Result<napi::JsString> {
  let db = DB.read().unwrap();
  let s = db.file_name(file_id);
  env.create_string(s)
}

#[napi(object)]
struct EnvironmentOpts {
  pub context: String,
  pub output_format: String,
  pub source_type: String,
  pub is_library: bool,
  pub should_optimize: bool,
  pub should_scope_hoist: bool,
}

impl Into<Environment> for EnvironmentOpts {
  fn into(self) -> Environment {
    Environment {
      context: match self.context.as_ref() {
        "browser" => EnvironmentContext::Browser,
        "web-worker" => EnvironmentContext::WebWorker,
        _ => todo!(),
      },
      output_format: match self.output_format.as_ref() {
        "global" => OutputFormat::Global,
        "esmodule" => OutputFormat::EsModule,
        "commonjs" => OutputFormat::CommonJs,
        _ => unreachable!(),
      },
      source_type: match self.source_type.as_ref() {
        "module" => SourceType::Module,
        "script" => SourceType::Script,
        _ => unreachable!(),
      },
      flags: {
        let mut flags = EnvironmentFlags::empty();
        if self.is_library {
          flags |= EnvironmentFlags::IS_LIBRARY;
        }

        if self.should_optimize {
          flags |= EnvironmentFlags::SHOULD_OPTIMIZE;
        }

        if self.should_scope_hoist {
          flags |= EnvironmentFlags::SHOULD_SCOPE_HOIST;
        }

        flags
      },
      loc: None,
    }
  }
}

#[napi]
fn create_environment(opts: EnvironmentOpts) -> u32 {
  DB.write().unwrap().environment_id(opts.into())
}

#[napi]
fn environment_is_library(id: u32) -> bool {
  let db = DB.read().unwrap();
  let env = db.environment(id);
  env.flags.contains(EnvironmentFlags::IS_LIBRARY)
}

#[napi]
fn environment_should_optimize(id: u32) -> bool {
  let db = DB.read().unwrap();
  let env = db.environment(id);
  env.flags.contains(EnvironmentFlags::SHOULD_OPTIMIZE)
}

#[napi]
fn environment_should_scope_hoist(id: u32) -> bool {
  let db = DB.read().unwrap();
  let env = db.environment(id);
  env.flags.contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
}

#[napi]
fn environment_context(id: u32) -> u8 {
  let db = DB.read().unwrap();
  let env = db.environment(id);
  env.context as u8
}

#[napi]
fn environment_output_format(id: u32) -> u8 {
  let db = DB.read().unwrap();
  let env = db.environment(id);
  env.output_format as u8
}

#[napi]
fn environment_source_type(id: u32) -> u8 {
  let db = DB.read().unwrap();
  let env = db.environment(id);
  env.source_type as u8
}

#[napi(object)]
struct DependencyOptions {
  pub asset_id: Option<u32>,
  pub env_id: u32,
  pub specifier: String,
  pub specifier_type: u8,
  pub resolve_from: Option<u32>,
  pub priority: u8,
  pub bundle_behavior: u8,
  pub needs_stable_name: bool,
  pub is_entry: bool,
  pub is_optional: bool,
}

impl Into<Dependency> for DependencyOptions {
  fn into(self) -> Dependency {
    Dependency {
      asset_id: self.asset_id,
      env_id: self.env_id,
      specifier: self.specifier,
      specifier_type: SpecifierType::from_u8(self.specifier_type).unwrap(),
      resolve_from: self.resolve_from,
      priority: Priority::from_u8(self.priority).unwrap(),
      bundle_behavior: BundleBehavior::from_u8(self.bundle_behavior).unwrap(),
      flags: {
        let mut flags = DependencyFlags::empty();
        if self.is_entry {
          flags |= DependencyFlags::ENTRY;
        }

        if self.is_optional {
          flags |= DependencyFlags::OPTIONAL;
        }

        if self.needs_stable_name {
          flags |= DependencyFlags::NEEDS_STABLE_NAME;
        }

        flags
      },
      loc: None,
    }
  }
}

#[napi]
fn create_dependency(opts: DependencyOptions) -> u32 {
  DB.write().unwrap().create_dependency(opts.into())
}

#[napi]
fn dependency_specifier(env: Env, id: u32) -> napi::Result<napi::JsString> {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  env.create_string(&dep.specifier)
}

#[napi]
fn dependency_env(id: u32) -> u32 {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.env_id
}

#[napi]
fn dependency_resolve_from(id: u32) -> Option<u32> {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.resolve_from
  // if let Some(r) = dep.resolve_from {
  //   Ok(Some(file_name(env, r)?))
  // } else {
  //   Ok(None)
  // }
}

#[napi]
fn dependency_specifier_type(id: u32) -> u8 {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.specifier_type as u8
}

#[napi]
fn dependency_priority(id: u32) -> u8 {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.priority as u8
}

#[napi]
fn dependency_bundle_behavior(id: u32) -> u8 {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.bundle_behavior as u8
}

#[napi]
fn dependency_is_entry(id: u32) -> bool {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.flags.contains(DependencyFlags::ENTRY)
}

#[napi]
fn dependency_needs_stable_name(id: u32) -> bool {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME)
}

#[napi]
fn dependency_is_optional(id: u32) -> bool {
  let db = DB.read().unwrap();
  let dep = db.dependency(id);
  dep.flags.contains(DependencyFlags::OPTIONAL)
}

#[derive(Default)]
struct ParcelDb {
  files: StringArena,
  environments: Arena<Environment>,
  dependencies: Arena<Dependency>,
  assets: Arena<Asset>,
}

impl ParcelDb {
  fn file_id(&mut self, name: &str) -> u32 {
    self.files.intern(name)
  }

  pub fn file_name(&self, file_id: u32) -> &str {
    self.files.lookup(file_id)
  }

  pub fn environment_id(&mut self, env: Environment) -> u32 {
    // There probably aren't that many environments, so linear search is fine.
    if let Some((index, _)) = self.environments.iter().find(|(_, e)| **e == env) {
      index.into_raw_parts().0 as u32
    } else {
      println!("Create environment {:?}", env);
      self.environments.insert(env).into_raw_parts().0 as u32
    }
  }

  pub fn environment(&self, id: u32) -> &Environment {
    self
      .environments
      .get(Index::from_raw_parts(id as usize, 0))
      .unwrap()
  }

  pub fn create_dependency(&mut self, dependency: Dependency) -> u32 {
    println!("Create dependency {:?}", dependency);
    self.dependencies.insert(dependency).into_raw_parts().0 as u32
  }

  pub fn dependency(&self, id: u32) -> &Dependency {
    self
      .dependencies
      .get(Index::from_raw_parts(id as usize, 0))
      .unwrap()
  }

  pub fn create_asset(&mut self, asset: Asset) -> u32 {
    self.assets.insert(asset).into_raw_parts().0 as u32
  }

  pub fn asset(&self, id: u32) -> &Asset {
    self
      .assets
      .get(Index::from_raw_parts(id as usize, 0))
      .unwrap()
  }
}

#[derive(PartialEq, Debug)]
struct SourceLocation {
  file_id: u32,
  start: Location,
  end: Location,
}

#[derive(PartialEq, Debug)]
struct Location {
  line: u32,
  column: u32,
}

struct Target {
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
struct Environment {
  context: EnvironmentContext,
  output_format: OutputFormat,
  source_type: SourceType,
  flags: EnvironmentFlags,
  // source_map
  loc: Option<SourceLocation>,
}

enum IncludeNodeModules {
  Bool(bool),
  // Include()
}

bitflags! {
  struct EnvironmentFlags: u8 {
    const IS_LIBRARY = 0b00000001;
    const SHOULD_OPTIMIZE = 0b00000010;
    const SHOULD_SCOPE_HOIST = 0b00000100;
  }
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum EnvironmentContext {
  Browser,
  WebWorker,
  ServiceWorker,
  Worklet,
  Node,
  ElectronMain,
  ElectronRenderer,
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum SourceType {
  Module,
  Script,
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum OutputFormat {
  Global,
  CommonJs,
  EsModule,
}

struct Asset {
  file_id: u32,
  env_id: u32,
  content_key: u32,
  map_key: u32,
  output_hash: u64,
  // meta??
  stats: AssetStats,
  // symbols
  unique_key: u64,

  asset_type: AssetType,
  bundle_behavior: BundleBehavior,
  flags: AssetFlags,
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
enum AssetType {
  Js,
  Css,
  Html,
  Other,
}

#[derive(Debug, FromPrimitive, Clone, Copy)]
enum BundleBehavior {
  None,
  Inline,
  Isolated,
}

#[derive(Debug, Default)]
struct AssetStats {
  size: u32,
  time: u32,
}

bitflags! {
  struct AssetFlags: u8 {
    const IS_SOURCE = 0b00000001;
    const SIDE_EFFECTS = 0b00000010;
    const IS_BUNDLE_SPLITTABLE = 0b00000100;
  }
}

#[derive(Debug)]
struct Dependency {
  asset_id: Option<u32>,
  env_id: u32,
  specifier: String,
  specifier_type: SpecifierType,
  resolve_from: Option<u32>,
  priority: Priority,
  bundle_behavior: BundleBehavior,
  flags: DependencyFlags,
  loc: Option<SourceLocation>,
  // meta/resolver_meta/target
  // symbols
  // range
  // pipeline
}

bitflags! {
  struct DependencyFlags: u8 {
    const ENTRY    = 0b00000001;
    const OPTIONAL = 0b00000010;
    const NEEDS_STABLE_NAME = 0b00000100;
  }
}

#[derive(FromPrimitive, Clone, Copy, Debug)]
enum SpecifierType {
  Esm,
  CommonJs,
  Url,
  Custom,
}

#[derive(FromPrimitive, Clone, Copy, Debug)]
enum Priority {
  Sync,
  Parallel,
  Lazy,
}

enum AssetGraphNode {
  Asset(u32),
  Dependency(u32),
}
