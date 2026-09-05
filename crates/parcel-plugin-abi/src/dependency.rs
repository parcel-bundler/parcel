//! Asset dependency mutation and read-only dependency accessors.

use std::sync::Arc;

use parcel_core::{
  Asset as CoreAsset, Dependency as CoreDependency, DependencyFlags as CoreDependencyFlags,
  DependencyResolution, ExportsCondition as CoreExportsCondition, ImportType,
  Priority as CorePriority, SpecifierType as CoreSpecifierType,
};

use crate::{
  Asset, Buffer, BundleBehavior, Dependency, Options, Target, bytes_to_str, write_buffer,
};

// SpecifierType — how a dependency specifier is interpreted
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum SpecifierType {
  PARCEL_SPECIFIER_ESM = 0,
  PARCEL_SPECIFIER_COMMONJS = 1,
  PARCEL_SPECIFIER_URL = 2,
  PARCEL_SPECIFIER_CUSTOM = 3,
}

// Priority — when a dependency is loaded
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum Priority {
  PARCEL_PRIORITY_SYNC = 0,
  PARCEL_PRIORITY_PARALLEL = 1,
  PARCEL_PRIORITY_LAZY = 2,
}

impl_enum_conversion! {
  CoreSpecifierType => SpecifierType {
    CoreSpecifierType::Esm => SpecifierType::PARCEL_SPECIFIER_ESM,
    CoreSpecifierType::Commonjs => SpecifierType::PARCEL_SPECIFIER_COMMONJS,
    CoreSpecifierType::Url => SpecifierType::PARCEL_SPECIFIER_URL,
    CoreSpecifierType::Custom => SpecifierType::PARCEL_SPECIFIER_CUSTOM,
  }
}

impl_enum_conversion! {
  CorePriority => Priority {
    CorePriority::Sync => Priority::PARCEL_PRIORITY_SYNC,
    CorePriority::Parallel => Priority::PARCEL_PRIORITY_PARALLEL,
    CorePriority::Lazy => Priority::PARCEL_PRIORITY_LAZY,
  }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum DependencyFlags {
  PARCEL_DEP_ENTRY = 1 << 0,
  PARCEL_DEP_OPTIONAL = 1 << 1,
  PARCEL_DEP_NEEDS_STABLE_NAME = 1 << 2,
  PARCEL_DEP_IS_WEBWORKER = 1 << 3,
  PARCEL_DEP_SIDE_EFFECTS = 1 << 4,
  PARCEL_DEP_MACRO = 1 << 5,
}

pub type DependencyFlagsFFI = u8;

/// Conditions used when resolving package `exports` and `imports` fields.
#[repr(u32)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum ExportsConditions {
  PARCEL_EXPORTS_CONDITION_IMPORT = 1 << 0,
  PARCEL_EXPORTS_CONDITION_REQUIRE = 1 << 1,
  PARCEL_EXPORTS_CONDITION_MODULE = 1 << 2,
  PARCEL_EXPORTS_CONDITION_NODE = 1 << 3,
  PARCEL_EXPORTS_CONDITION_BROWSER = 1 << 4,
  PARCEL_EXPORTS_CONDITION_WORKER = 1 << 5,
  PARCEL_EXPORTS_CONDITION_WORKLET = 1 << 6,
  PARCEL_EXPORTS_CONDITION_ELECTRON = 1 << 7,
  PARCEL_EXPORTS_CONDITION_DEVELOPMENT = 1 << 8,
  PARCEL_EXPORTS_CONDITION_PRODUCTION = 1 << 9,
  PARCEL_EXPORTS_CONDITION_TYPES = 1 << 10,
  PARCEL_EXPORTS_CONDITION_DEFAULT = 1 << 11,
  PARCEL_EXPORTS_CONDITION_STYLE = 1 << 12,
  PARCEL_EXPORTS_CONDITION_SASS = 1 << 13,
  PARCEL_EXPORTS_CONDITION_LESS = 1 << 14,
  PARCEL_EXPORTS_CONDITION_STYLUS = 1 << 15,
  PARCEL_EXPORTS_CONDITION_REACT_SERVER = 1 << 16,
  PARCEL_EXPORTS_CONDITION_SOURCE = 1 << 17,
}

pub type ExportsConditionsFFI = u32;

assert_flag_values! {
  core = CoreDependencyFlags,
  abi = DependencyFlags,
  repr = u8;
  flags = {
    ENTRY => PARCEL_DEP_ENTRY,
    OPTIONAL => PARCEL_DEP_OPTIONAL,
    NEEDS_STABLE_NAME => PARCEL_DEP_NEEDS_STABLE_NAME,
    IS_WEBWORKER => PARCEL_DEP_IS_WEBWORKER,
    SIDE_EFFECTS => PARCEL_DEP_SIDE_EFFECTS,
    MACRO => PARCEL_DEP_MACRO,
  }
  ignored = [REACT_LAZY, FORCE_BUNDLE];
}

assert_flag_values! {
  core = CoreExportsCondition,
  abi = ExportsConditions,
  repr = u32;
  flags = {
    IMPORT => PARCEL_EXPORTS_CONDITION_IMPORT,
    REQUIRE => PARCEL_EXPORTS_CONDITION_REQUIRE,
    MODULE => PARCEL_EXPORTS_CONDITION_MODULE,
    NODE => PARCEL_EXPORTS_CONDITION_NODE,
    BROWSER => PARCEL_EXPORTS_CONDITION_BROWSER,
    WORKER => PARCEL_EXPORTS_CONDITION_WORKER,
    WORKLET => PARCEL_EXPORTS_CONDITION_WORKLET,
    ELECTRON => PARCEL_EXPORTS_CONDITION_ELECTRON,
    DEVELOPMENT => PARCEL_EXPORTS_CONDITION_DEVELOPMENT,
    PRODUCTION => PARCEL_EXPORTS_CONDITION_PRODUCTION,
    TYPES => PARCEL_EXPORTS_CONDITION_TYPES,
    DEFAULT => PARCEL_EXPORTS_CONDITION_DEFAULT,
    STYLE => PARCEL_EXPORTS_CONDITION_STYLE,
    SASS => PARCEL_EXPORTS_CONDITION_SASS,
    LESS => PARCEL_EXPORTS_CONDITION_LESS,
    STYLUS => PARCEL_EXPORTS_CONDITION_STYLUS,
    REACT_SERVER => PARCEL_EXPORTS_CONDITION_REACT_SERVER,
    SOURCE => PARCEL_EXPORTS_CONDITION_SOURCE,
  }
}

/// Dependency descriptor passed to `parcel_asset_add_dependency()`.
/// Use `PARCEL_SPECIFIER_ESM` / `PARCEL_PRIORITY_SYNC` / `PARCEL_BUNDLE_BEHAVIOR_NONE` as defaults.
#[repr(C)]
pub struct DependencyOptions {
  /// Module specifier bytes (e.g. `"./foo.js"`). Required.
  pub specifier: *const u8,
  /// Byte length of `specifier`.
  pub specifier_len: usize,
  /// `PARCEL_SPECIFIER_*`
  pub specifier_type: SpecifierType,
  /// `PARCEL_PRIORITY_*`
  pub priority: Priority,
  /// `PARCEL_BUNDLE_BEHAVIOR_*`
  pub bundle_behavior: BundleBehavior,
  /// `PARCEL_DEP_*` bits
  pub flags: DependencyFlagsFFI,
  /// `PARCEL_EXPORTS_CONDITION_*` bits
  pub conditions: ExportsConditionsFFI,
}
// ── Dependencies ──────────────────────────────────────────────────────────────

/// Returns the number of dependencies belonging to an asset.
pub extern "C" fn parcel_asset_get_dependency_count(asset: Asset) -> usize {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.len()
}

/// Returns a borrowed, read-only dependency handle, or zero when `index` is out of bounds.
/// The handle is valid only for the lifetime of the asset.
pub extern "C" fn parcel_asset_get_dependency(asset: Asset, index: usize) -> Dependency {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.get(index).map_or(0, |dependency| {
    dependency as *const CoreDependency as Dependency
  })
}

/// Appends a dependency to the asset. The new dependency inherits the asset's target.
pub extern "C" fn parcel_asset_add_dependency(asset: Asset, dep: *const DependencyOptions) {
  if dep.is_null() {
    return;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let dep = unsafe { &*dep };

  if dep.specifier.is_null() {
    return;
  }
  let specifier = unsafe { bytes_to_str(dep.specifier, dep.specifier_len) }.to_owned();

  let specifier_type = dep.specifier_type.into();
  let priority = dep.priority.into();
  let bundle_behavior = dep.bundle_behavior.into();
  let flags = CoreDependencyFlags::from_bits_truncate(dep.flags);

  asset.dependencies.push(CoreDependency {
    specifier,
    specifier_type,
    priority,
    bundle_behavior,
    import_type: ImportType::JavaScript, // TODO
    flags,
    target: asset.target.clone(),
    loc: None,
    placeholder: None,
    resolve_from: Some(asset.loc.url.clone()),
    range: None,
    conditions: CoreExportsCondition::from_bits_truncate(dep.conditions),
    resolution: DependencyResolution::None,
  });
}

// ── Dependency accessors (read-only) ──────────────────────────────────────────

/// Returns the raw specifier string (e.g. `"custom:greeting"`) into `*buf`.
pub extern "C" fn parcel_dep_get_specifier(buf: *mut Buffer, dep: Dependency) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  unsafe { write_buffer(buf, dep.specifier.as_bytes().to_vec(), true) };
}

/// Returns the specifier type (`PARCEL_SPECIFIER_*`).
pub extern "C" fn parcel_dep_get_specifier_type(dep: Dependency) -> SpecifierType {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.specifier_type.into()
}

/// Returns the priority (`PARCEL_PRIORITY_*`).
pub extern "C" fn parcel_dep_get_priority(dep: Dependency) -> Priority {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.priority.into()
}

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
pub extern "C" fn parcel_dep_get_bundle_behavior(dep: Dependency) -> BundleBehavior {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.bundle_behavior.into()
}

/// Returns the raw `DependencyFlags` bitfield (`PARCEL_DEP_*` bits).
pub extern "C" fn parcel_dep_get_flags(dep: Dependency) -> DependencyFlagsFFI {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.flags.bits()
}

/// Returns the raw `ExportsConditions` bitfield (`PARCEL_EXPORTS_CONDITION_*` bits).
pub extern "C" fn parcel_dep_get_conditions(dep: Dependency) -> ExportsConditionsFFI {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.conditions.bits()
}

/// Returns the absolute path of the file containing this import into `*buf`.
pub extern "C" fn parcel_dep_get_source_path(buf: *mut Buffer, dep: Dependency, _options: Options) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  let Some(loc) = &dep.loc else { return };
  let Ok(path) = loc.url.to_file_path() else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

/// Returns the base path for resolving the specifier into `*buf`.
/// Falls back to the source file path when `resolve_from` is not set.
pub extern "C" fn parcel_dep_get_resolve_from(
  buf: *mut Buffer,
  dep: Dependency,
  _options: Options,
) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  let url = dep
    .resolve_from
    .as_ref()
    .or_else(|| dep.loc.as_ref().map(|loc| &loc.url));
  let Some(url) = url else { return };
  let Ok(path) = url.to_file_path() else {
    return;
  };
  unsafe {
    write_buffer(
      buf,
      path
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

/// Returns an opaque `Target` handle for the dependency.
pub extern "C" fn parcel_dep_get_target(dep: Dependency) -> Target {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  Arc::as_ptr(&dep.target) as u64
}
