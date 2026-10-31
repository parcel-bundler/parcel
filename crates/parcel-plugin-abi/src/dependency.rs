//! Asset dependency mutation and read-only dependency accessors.

use std::sync::Arc;

use parcel_core::{
  Asset as CoreAsset, Dependency as CoreDependency, DependencyFlags as CoreDependencyFlags,
  DependencyResolution, Diagnostic as CoreDiagnostic, ExportsCondition as CoreExportsCondition,
  ImportType as CoreImportType, Priority as CorePriority, SourceUrl,
  SpecifierType as CoreSpecifierType,
};

use crate::{
  Asset, AssetRef, Buffer, BundleBehavior, BundleBehaviorFFI, Dependency, Diagnostics, Options,
  ResolutionType, ResolveResult, Target,
  extensible::{Extensible, read_extensible, unknown_fields_are_zero, write_extensible},
  options_context, path_arg, plugin_str, write_buffer,
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

pub type SpecifierTypeFFI = u8;

// Priority — when a dependency is loaded
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum Priority {
  PARCEL_PRIORITY_SYNC = 0,
  PARCEL_PRIORITY_PARALLEL = 1,
  PARCEL_PRIORITY_LAZY = 2,
}

pub type PriorityFFI = u8;

impl_enum_conversion! {
  CoreSpecifierType => SpecifierType {
    CoreSpecifierType::Esm => SpecifierType::PARCEL_SPECIFIER_ESM,
    CoreSpecifierType::Commonjs => SpecifierType::PARCEL_SPECIFIER_COMMONJS,
    CoreSpecifierType::Url => SpecifierType::PARCEL_SPECIFIER_URL,
    CoreSpecifierType::Custom => SpecifierType::PARCEL_SPECIFIER_CUSTOM,
  }
}

// ImportType — what a dependency evaluates to in the code that imports it
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum ImportType {
  /// The module's exports. A file imported this way must have a transformer that turns it into
  /// JavaScript, or it is an error.
  PARCEL_IMPORT_TYPE_JAVASCRIPT = 0,
  /// A `CSSStyleSheet`.
  PARCEL_IMPORT_TYPE_STYLESHEET = 1,
  /// The URL of the file. Any file can be referenced this way, transformed or not.
  PARCEL_IMPORT_TYPE_URL = 2,
  /// The bundle's contents as a string.
  PARCEL_IMPORT_TYPE_TEXT = 3,
  /// The bundle's contents as bytes.
  PARCEL_IMPORT_TYPE_BYTES = 4,
}

pub type ImportTypeFFI = u8;

impl_enum_conversion! {
  CoreImportType => ImportType {
    CoreImportType::JavaScript => ImportType::PARCEL_IMPORT_TYPE_JAVASCRIPT,
    CoreImportType::StyleSheet => ImportType::PARCEL_IMPORT_TYPE_STYLESHEET,
    CoreImportType::Url => ImportType::PARCEL_IMPORT_TYPE_URL,
    CoreImportType::Text => ImportType::PARCEL_IMPORT_TYPE_TEXT,
    CoreImportType::Bytes => ImportType::PARCEL_IMPORT_TYPE_BYTES,
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

/// Dependency descriptor passed to `parcel_asset_add_dependency()` and `parcel_asset_resolve()`.
///
/// Initialize it as `DependencyOptions dep = {.size = sizeof(DependencyOptions)};`, which zeroes the rest:
/// `PARCEL_SPECIFIER_ESM` / `PARCEL_PRIORITY_SYNC` / `PARCEL_BUNDLE_BEHAVIOR_NONE` /
/// `PARCEL_IMPORT_TYPE_JAVASCRIPT` and no flags are the defaults. Zero any padding too, e.g. with
/// `memset`, if you fill it in some other way: a field a newer header adds lands where an older
/// Parcel sees only bytes it expects to be zero, and it rejects a dependency that sets anything it
/// does not understand rather than silently ignoring it.
#[repr(C)]
pub struct DependencyOptions {
  /// `sizeof(DependencyOptions)`. Always the first member.
  pub size: usize,
  /// Module specifier bytes (e.g. `"./foo.js"`). Required.
  pub specifier: *const u8,
  /// Byte length of `specifier`.
  pub specifier_len: usize,
  /// `PARCEL_SPECIFIER_*`
  pub specifier_type: SpecifierTypeFFI,
  /// `PARCEL_PRIORITY_*`
  pub priority: PriorityFFI,
  /// `PARCEL_BUNDLE_BEHAVIOR_*`
  pub bundle_behavior: BundleBehaviorFFI,
  /// `PARCEL_DEP_*` bits
  pub flags: DependencyFlagsFFI,
  /// `PARCEL_EXPORTS_CONDITION_*` bits
  pub conditions: ExportsConditionsFFI,
  /// `PARCEL_IMPORT_TYPE_*`
  pub import_type: ImportTypeFFI,
}

impl_extensible!(
  DependencyOptions,
  min_size = std::mem::offset_of!(DependencyOptions, import_type) + size_of::<ImportTypeFFI>()
);

// ── Dependencies ──────────────────────────────────────────────────────────────

/// Returns the number of dependencies belonging to an asset.
pub extern "C" fn parcel_asset_get_dependency_count(asset: AssetRef) -> usize {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.len()
}

/// Returns a borrowed, read-only dependency handle, or zero when `index` is out of bounds.
/// The handle is valid until the next `parcel_asset_add_dependency()` on the same asset, which may
/// move the asset's dependencies, or until the call that obtained it returns.
pub extern "C" fn parcel_asset_get_dependency(asset: AssetRef, index: usize) -> Dependency {
  if asset == 0 {
    return 0;
  }
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  asset.dependencies.get(index).map_or(0, |dependency| {
    dependency as *const CoreDependency as Dependency
  })
}

impl DependencyOptions {
  /// The dependency described by the options a plugin passed, imported by `asset` from
  /// `resolve_from`. It inherits the asset's target.
  ///
  /// `None` when the options cannot be honored: no specifier or one that is not valid UTF-8, a `size` no version of the ABI
  /// produces, an enum value this build does not know, or a field it does not know set to anything
  /// but its default. Each of those means a plugin asked for something other than what it would
  /// get, so it is an error rather than a fallback. Unknown flag bits are the exception, and are
  /// dropped, as they always have been.
  ///
  /// # Safety
  ///
  /// `raw` must be non-null and point to `(*raw).size` readable bytes, and its `specifier` to
  /// `specifier_len` readable bytes.
  unsafe fn read(
    raw: *const DependencyOptions,
    asset: &CoreAsset,
    resolve_from: SourceUrl,
  ) -> Option<CoreDependency> {
    let (options, size) = unsafe { read_extensible(raw) }?;
    if !unsafe { unknown_fields_are_zero(raw, size) } || options.specifier.is_null() {
      return None;
    }
    let specifier = unsafe { plugin_str(options.specifier, options.specifier_len) }?;

    Some(CoreDependency {
      specifier: specifier.into(),
      specifier_type: SpecifierType::try_from(options.specifier_type).ok()?.into(),
      priority: Priority::try_from(options.priority).ok()?.into(),
      bundle_behavior: BundleBehavior::try_from(options.bundle_behavior)
        .ok()?
        .into(),
      import_type: ImportType::try_from(options.import_type).ok()?.into(),
      flags: CoreDependencyFlags::from_bits_truncate(options.flags),
      target: asset.target.clone(),
      loc: None,
      placeholder: None,
      resolve_from: Some(resolve_from),
      range: None,
      conditions: CoreExportsCondition::from_bits_truncate(options.conditions),
      resolution: DependencyResolution::None,
      concurrent_group: 0,
      custom_conditions: Default::default(),
    })
  }
}

/// Appends a dependency to the asset. The new dependency inherits the asset's target.
///
/// Returns false, adding nothing, when Parcel cannot honor `dep`: it has no specifier, or its
/// `size` is unset, or it uses a value or field this version of Parcel does not support.
pub extern "C" fn parcel_asset_add_dependency(asset: Asset, dep: *const DependencyOptions) -> bool {
  if asset == 0 || dep.is_null() {
    return false;
  }
  let asset = unsafe { &mut *(asset as *mut CoreAsset) };
  let from = asset.loc.url.clone();
  let Some(dep) = (unsafe { DependencyOptions::read(dep, asset, from) }) else {
    return false;
  };
  asset.dependencies.push(dep);
  true
}

/// Resolves a dependency of `asset` with the configured resolver plugins, exactly as one added
/// with `parcel_asset_add_dependency()` would be, without adding it.
///
/// `from` is the absolute path of the file containing the import, for an import inside a file the
/// asset itself pulled in (e.g. a Sass partial). Pass an empty `from` to resolve from the asset.
///
/// Every file the resolvers read or probe is recorded as an invalidation of the asset, so the
/// transform re-runs when the result would change. Only available while transforming.
///
/// Fills `*result`, whose `size` the caller sets, and returns true when the resolvers ran:
/// `resolution_type` is `PARCEL_RESOLUTION_NONE` when none of them resolved the dependency, and
/// for `PARCEL_RESOLUTION_FILE_PATH`, `file_path` and, when the resolver chose one, `pipeline` are
/// set. The caller must `parcel_free_buffer()` both.
///
/// Returns false when a resolver failed, when Parcel cannot honor `dep` (see
/// `parcel_asset_add_dependency()`), or when called outside a transform. Then, if `options` is the
/// current call's handle, `*diagnostics` is set to a list saying why, including every diagnostic
/// a failing resolver reported: read it, or fail with it unchanged by setting
/// `DiagnosticOptions.diagnostics`.
pub extern "C" fn parcel_asset_resolve(
  asset: Asset,
  options: Options,
  dep: *const DependencyOptions,
  from: *const u8,
  from_len: usize,
  result: *mut ResolveResult,
  diagnostics: *mut Diagnostics,
) -> bool {
  if asset == 0 || options == 0 || dep.is_null() || result.is_null() {
    return false;
  }
  let context = unsafe { options_context(options) };
  let fail = |message: &str| {
    if !diagnostics.is_null() {
      let diagnostic = CoreDiagnostic::from_message(format!("parcel_asset_resolve: {message}"));
      unsafe { *diagnostics = context.hand_out(vec![diagnostic]) };
    }
    false
  };
  // Checked up front, so a resolution is never computed only to be dropped.
  if unsafe { result.cast::<usize>().read() } < ResolveResult::MIN_SIZE {
    return fail("the result's size is too small for any version of ResolveResult");
  }
  let Some(plugin) = context.plugin else {
    return fail("only available while transforming");
  };
  let asset = unsafe { &*(asset as *const CoreAsset) };
  let resolve_from = if from_len == 0 {
    asset.loc.url.clone()
  } else {
    match unsafe { path_arg(from, from_len) } {
      Some(from) => SourceUrl::from_path(&from),
      None => return fail("`from` must be an absolute path"),
    }
  };
  let Some(dep) = (unsafe { DependencyOptions::read(dep, asset, resolve_from) }) else {
    return fail("the DependencyOptions ask for something this version of Parcel does not support");
  };

  let resolution = match plugin.resolve(&dep) {
    Ok(resolution) => resolution,
    Err(errors) => {
      if !diagnostics.is_null() {
        unsafe { *diagnostics = context.hand_out(errors.0) };
      }
      return false;
    }
  };

  let mut resolved = ResolveResult::default();
  match resolution {
    DependencyResolution::Deferred(req) => {
      // A request for something other than a file, e.g. a virtual module, has no path to hand
      // back.
      if let Ok(path) = req.loc.url.to_file_path() {
        let path = path.to_path_buf().to_string_lossy().into_owned();
        resolved.resolution_type = ResolutionType::PARCEL_RESOLUTION_FILE_PATH as u8;
        unsafe { write_buffer(&mut resolved.file_path, path.into_bytes(), true) };
        if let Some(pipeline) = &req.pipeline {
          unsafe { write_buffer(&mut resolved.pipeline, pipeline.as_bytes().to_vec(), true) };
        }
      }
    }
    DependencyResolution::External => {
      resolved.resolution_type = ResolutionType::PARCEL_RESOLUTION_EXTERNAL as u8;
    }
    DependencyResolution::Excluded => {
      resolved.resolution_type = ResolutionType::PARCEL_RESOLUTION_EXCLUDED as u8;
    }
    DependencyResolution::None | DependencyResolution::Asset(_) => {}
  }
  unsafe { write_extensible(result, resolved) }
}

// ── Dependency accessors (read-only) ──────────────────────────────────────────

/// Returns the raw specifier string (e.g. `"custom:greeting"`) into `*buf`.
pub extern "C" fn parcel_dep_get_specifier(buf: *mut Buffer, dep: Dependency) {
  if buf.is_null() || dep == 0 {
    return;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  unsafe { write_buffer(buf, dep.specifier.as_bytes().to_vec(), true) };
}

/// Returns the specifier type (`PARCEL_SPECIFIER_*`).
pub extern "C" fn parcel_dep_get_specifier_type(dep: Dependency) -> SpecifierType {
  if dep == 0 {
    return SpecifierType::PARCEL_SPECIFIER_ESM;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.specifier_type.into()
}

/// Returns the priority (`PARCEL_PRIORITY_*`).
pub extern "C" fn parcel_dep_get_priority(dep: Dependency) -> Priority {
  if dep == 0 {
    return Priority::PARCEL_PRIORITY_SYNC;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.priority.into()
}

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
pub extern "C" fn parcel_dep_get_bundle_behavior(dep: Dependency) -> BundleBehavior {
  if dep == 0 {
    return BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.bundle_behavior.into()
}

/// Returns the raw `DependencyFlags` bitfield (`PARCEL_DEP_*` bits).
pub extern "C" fn parcel_dep_get_flags(dep: Dependency) -> DependencyFlagsFFI {
  if dep == 0 {
    return 0;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.flags.bits()
}

/// Returns the raw `ExportsConditions` bitfield (`PARCEL_EXPORTS_CONDITION_*` bits).
pub extern "C" fn parcel_dep_get_conditions(dep: Dependency) -> ExportsConditionsFFI {
  if dep == 0 {
    return 0;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.conditions.bits()
}

/// Returns how the importing asset uses the resolved one (`PARCEL_IMPORT_TYPE_*`).
pub extern "C" fn parcel_dep_get_import_type(dep: Dependency) -> ImportType {
  if dep == 0 {
    return ImportType::PARCEL_IMPORT_TYPE_JAVASCRIPT;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  dep.import_type.into()
}

/// Returns the absolute path of the file containing this import into `*buf`.
pub extern "C" fn parcel_dep_get_source_path(buf: *mut Buffer, dep: Dependency, _options: Options) {
  if buf.is_null() || dep == 0 {
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
  if buf.is_null() || dep == 0 {
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
  if dep == 0 {
    return 0;
  }
  let dep: &CoreDependency = unsafe { &*(dep as *const CoreDependency) };
  Arc::as_ptr(&dep.target) as u64
}
