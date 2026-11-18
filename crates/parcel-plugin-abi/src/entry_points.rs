//! The functions a plugin exports for Parcel to call.
//!
//! Each is declared here as a function pointer type, which is what Parcel loads
//! the symbol as. plugin.h turns every `ParcelPlugin*Fn` into a prototype for the
//! function the plugin defines (`parcel_plugin_init()` and so on), so a plugin
//! whose definition drifts from these fails to compile.

use std::ffi::c_void;

use crate::{
  Asset, Bundle, BundleGraph, Dependency, DiagnosticOptions, OptimizeResult, Options, ParcelApi,
  ReportEvent, ResolveResult,
};

/// The raw byte `parcel_plugin_init()` returns, one of `PARCEL_INIT_*`. Parcel
/// reads it as a byte because an unknown value would be undefined behavior to
/// read as the enum.
pub type InitStatusFFI = u8;

/// `parcel_plugin_init()`: the original form of `parcel_plugin_init2()`, which
/// Parcel calls instead when a plugin exports both. It receives only the entry's
/// options as JSON in `config`: no `Options`, so it cannot read files or the
/// project root, and no path to the .parcelrc that configured it. Kept so that
/// plugins built before `parcel_plugin_init2()` keep loading; new plugins should
/// define `parcel_plugin_init2()` instead.
///
/// Check `parcel_api_compatible(&api->header)` first, and return
/// `PARCEL_INIT_INCOMPATIBLE` without touching `api` if it fails. Store anything
/// the other entry points need in `*state`, which every later call for this
/// entry receives. On failure, return `PARCEL_INIT_ERROR` and fill in
/// `diagnostic`.
pub type ParcelPluginInitFn = extern "C" fn(
  api: *const ParcelApi,
  config: *const u8,
  config_len: usize,
  state: *mut *mut c_void,
  diagnostic: *mut DiagnosticOptions,
) -> InitStatusFFI;

/// The inputs to `parcel_plugin_init2()`.
///
/// Parcel allocates it and sets `size` to `sizeof(InitArgs)` as Parcel was
/// built. Fields may be appended in later versions: check one with
/// `PARCEL_HAS_FIELD()` before reading it, unless it is in the first layout
/// (through `options`), which every Parcel calling `parcel_plugin_init2()` fills
/// in. Everything it points to is valid only until `parcel_plugin_init2()`
/// returns: copy what you need into your state.
#[repr(C)]
pub struct InitArgs {
  /// `sizeof(InitArgs)` as Parcel was built. Always the first member.
  pub size: usize,
  /// The host functions. Check `parcel_api_compatible(&args->api->header)`
  /// before using it, or anything else Parcel passed.
  pub api: *const ParcelApi,
  /// The .parcelrc entry's options, as JSON. Not NUL-terminated. Empty when the
  /// entry has none.
  pub config: *const u8,
  pub config_len: usize,
  /// The absolute path of the .parcelrc file whose entry named the plugin: the
  /// file itself, not its directory. When the entry comes from a config that
  /// file `extends`, this is that config's path. Resolve relative paths in
  /// `config` against its directory. Not NUL-terminated.
  pub config_path: *const u8,
  pub config_path_len: usize,
  /// The build's options, for the duration of this call, as every other entry
  /// point receives them. Files read through it with `parcel_fs_read_file()`
  /// and friends are tracked: a change to any of them reinitializes every
  /// plugin. Never store it; `parcel_asset_resolve()` is not available.
  pub options: Options,
}

impl_extensible!(
  InitArgs,
  min_size = std::mem::offset_of!(InitArgs, options) + size_of::<Options>()
);

/// `parcel_plugin_init2()`: called once for each .parcelrc entry naming the
/// plugin, before any other entry point. It may be called concurrently, and
/// always with the same `args->api` table.
///
/// Check `parcel_api_compatible(&args->api->header)` first, and return
/// `PARCEL_INIT_INCOMPATIBLE` without touching anything else if it fails. Store
/// anything the other entry points need in `*state`, which every later call for
/// this entry receives. On failure, return `PARCEL_INIT_ERROR` and fill in
/// `diagnostic`.
pub type ParcelPluginInit2Fn = extern "C" fn(
  args: *const InitArgs,
  state: *mut *mut c_void,
  diagnostic: *mut DiagnosticOptions,
) -> InitStatusFFI;

/// `parcel_plugin_deinit()`: releases `state` once Parcel is done with the
/// entry and none of its other calls is still running. Not called when `state`
/// is NULL. Custom content the plugin created can outlive it, so content
/// callbacks must not rely on `state`.
pub type ParcelPluginDeinitFn = extern "C" fn(state: *mut c_void);

/// `parcel_plugin_transform()`: transforms `asset` in place. The only entry
/// point that receives a mutable `Asset`, valid until it returns. Fill in
/// `diagnostic` to fail.
pub type ParcelPluginTransformFn = extern "C" fn(
  asset: Asset,
  options: Options,
  state: *mut c_void,
  diagnostic: *mut DiagnosticOptions,
);

/// `parcel_plugin_resolve()`: resolves `specifier` (not NUL-terminated), as
/// imported by `dependency`. `pipeline` is the named pipeline from the
/// specifier, or NULL when it has none. Write the result into `*result`, whose
/// `size` Parcel set, or leave it as `PARCEL_RESOLUTION_NONE` to let the next
/// resolver try. Fill in `diagnostic` to fail.
pub type ParcelPluginResolveFn = extern "C" fn(
  dependency: Dependency,
  specifier: *const u8,
  specifier_len: usize,
  pipeline: *const u8,
  pipeline_len: usize,
  options: Options,
  result: *mut ResolveResult,
  state: *mut c_void,
  diagnostic: *mut DiagnosticOptions,
);

/// `parcel_plugin_name()`: writes `bundle`'s name, relative to its target's dist
/// directory, into `*name`. Leave `*name` empty to let the next namer try. Fill
/// in `diagnostic` to fail.
pub type ParcelPluginNameFn = extern "C" fn(
  bundle_graph: BundleGraph,
  bundle: Bundle,
  options: Options,
  name: *mut crate::Buffer,
  state: *mut c_void,
  diagnostic: *mut DiagnosticOptions,
);

/// `parcel_plugin_optimize()`: optimizes `bundle`'s packaged `contents`, along
/// with its JSON source map, which is NULL when it has none. Write the output
/// into `*result`, whose `size` Parcel set. Fill in `diagnostic` to fail.
pub type ParcelPluginOptimizeFn = extern "C" fn(
  bundle_graph: BundleGraph,
  bundle: Bundle,
  contents: *const u8,
  contents_len: usize,
  source_map: *const u8,
  source_map_len: usize,
  options: Options,
  result: *mut OptimizeResult,
  state: *mut c_void,
  diagnostic: *mut DiagnosticOptions,
);

/// `parcel_plugin_report()`: handles a build event. Log events can arrive from
/// any thread while a build runs, concurrently with each other. A diagnostic is
/// printed rather than failing the build.
pub type ParcelPluginReportFn = extern "C" fn(
  event: *const ReportEvent,
  options: Options,
  state: *mut c_void,
  diagnostic: *mut DiagnosticOptions,
);
