//! Asset dependency mutation and read-only dependency accessors.

use std::sync::Arc;

use parcel_core::{
  Asset as CoreAsset, BundleBehavior as CoreBundleBehavior, Dependency as CoreDependency,
  DependencyFlags as CoreDependencyFlags, DependencyResolution,
  ExportsCondition as CoreExportsCondition, Priority as CorePriority,
  SpecifierType as CoreSpecifierType,
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
const _: () =
  debug_assert!(CoreDependencyFlags::ENTRY.bits() == DependencyFlags::PARCEL_DEP_ENTRY as u8);
const _: () =
  debug_assert!(CoreDependencyFlags::OPTIONAL.bits() == DependencyFlags::PARCEL_DEP_OPTIONAL as u8);
const _: () = debug_assert!(
  CoreDependencyFlags::NEEDS_STABLE_NAME.bits()
    == DependencyFlags::PARCEL_DEP_NEEDS_STABLE_NAME as u8
);
const _: () = debug_assert!(
  CoreDependencyFlags::IS_WEBWORKER.bits() == DependencyFlags::PARCEL_DEP_IS_WEBWORKER as u8
);
const _: () = debug_assert!(
  CoreDependencyFlags::SIDE_EFFECTS.bits() == DependencyFlags::PARCEL_DEP_SIDE_EFFECTS as u8
);
const _: () =
  debug_assert!(CoreDependencyFlags::MACRO.bits() == DependencyFlags::PARCEL_DEP_MACRO as u8);

const _: () = debug_assert!(
  CoreExportsCondition::IMPORT.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_IMPORT as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::REQUIRE.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_REQUIRE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::MODULE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_MODULE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::NODE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_NODE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::BROWSER.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_BROWSER as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::WORKER.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_WORKER as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::WORKLET.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_WORKLET as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::ELECTRON.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_ELECTRON as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::DEVELOPMENT.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_DEVELOPMENT as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::PRODUCTION.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_PRODUCTION as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::TYPES.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_TYPES as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::DEFAULT.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_DEFAULT as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::STYLE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_STYLE as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::SASS.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_SASS as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::LESS.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_LESS as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::STYLUS.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_STYLUS as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::REACT_SERVER.bits()
    == ExportsConditions::PARCEL_EXPORTS_CONDITION_REACT_SERVER as u32
);
const _: () = debug_assert!(
  CoreExportsCondition::SOURCE.bits() == ExportsConditions::PARCEL_EXPORTS_CONDITION_SOURCE as u32
);
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
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_dependency_count(asset: Asset) -> usize {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.len()
}

/// Returns a borrowed, read-only dependency handle, or zero when `index` is out of bounds.
/// The handle is valid only for the lifetime of the asset.
#[unsafe(no_mangle)]
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
#[unsafe(no_mangle)]
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

  let specifier_type = match dep.specifier_type {
    SpecifierType::PARCEL_SPECIFIER_ESM => CoreSpecifierType::Esm,
    SpecifierType::PARCEL_SPECIFIER_COMMONJS => CoreSpecifierType::Commonjs,
    SpecifierType::PARCEL_SPECIFIER_URL => CoreSpecifierType::Url,
    SpecifierType::PARCEL_SPECIFIER_CUSTOM => CoreSpecifierType::Custom,
  };
  let priority = match dep.priority {
    Priority::PARCEL_PRIORITY_SYNC => CorePriority::Sync,
    Priority::PARCEL_PRIORITY_PARALLEL => CorePriority::Parallel,
    Priority::PARCEL_PRIORITY_LAZY => CorePriority::Lazy,
  };
  let bundle_behavior = match dep.bundle_behavior {
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE => CoreBundleBehavior::None,
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE => CoreBundleBehavior::Inline,
    BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED => CoreBundleBehavior::Isolated,
  };
  let flags = CoreDependencyFlags::from_bits_truncate(dep.flags);

  asset.dependencies.push(CoreDependency {
    specifier,
    specifier_type,
    priority,
    bundle_behavior,
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
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_specifier(buf: *mut Buffer, dep: Dependency) {
  if buf.is_null() {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  unsafe { write_buffer(buf, dep.specifier.as_bytes().to_vec(), true) };
}

/// Returns the specifier type (`PARCEL_SPECIFIER_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_specifier_type(dep: Dependency) -> SpecifierType {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  match dep.specifier_type {
    CoreSpecifierType::Esm => SpecifierType::PARCEL_SPECIFIER_ESM,
    CoreSpecifierType::Commonjs => SpecifierType::PARCEL_SPECIFIER_COMMONJS,
    CoreSpecifierType::Url => SpecifierType::PARCEL_SPECIFIER_URL,
    CoreSpecifierType::Custom => SpecifierType::PARCEL_SPECIFIER_CUSTOM,
  }
}

/// Returns the priority (`PARCEL_PRIORITY_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_priority(dep: Dependency) -> Priority {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  match dep.priority {
    CorePriority::Sync => Priority::PARCEL_PRIORITY_SYNC,
    CorePriority::Parallel => Priority::PARCEL_PRIORITY_PARALLEL,
    CorePriority::Lazy => Priority::PARCEL_PRIORITY_LAZY,
  }
}

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_bundle_behavior(dep: Dependency) -> BundleBehavior {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  match dep.bundle_behavior {
    CoreBundleBehavior::None => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    CoreBundleBehavior::Inline => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    CoreBundleBehavior::Isolated => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
  }
}

/// Returns the raw `DependencyFlags` bitfield (`PARCEL_DEP_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_flags(dep: Dependency) -> DependencyFlagsFFI {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.flags.bits()
}

/// Returns the raw `ExportsConditions` bitfield (`PARCEL_EXPORTS_CONDITION_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_conditions(dep: Dependency) -> ExportsConditionsFFI {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.conditions.bits()
}

/// Returns the absolute path of the file containing this import into `*buf`.
#[unsafe(no_mangle)]
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
#[unsafe(no_mangle)]
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
#[unsafe(no_mangle)]
pub extern "C" fn parcel_dep_get_target(dep: Dependency) -> Target {
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  Arc::as_ptr(&dep.target) as u64
}
