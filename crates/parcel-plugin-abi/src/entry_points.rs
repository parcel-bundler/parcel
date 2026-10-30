//! The functions a plugin exports for Parcel to call.
//!
//! Each is declared here as a function pointer type, which is what Parcel loads
//! the symbol as. plugin.h turns every `ParcelPlugin*Fn` into a prototype for the
//! function the plugin defines (`parcel_plugin_init()` and so on), so a plugin
//! whose definition drifts from these fails to compile.

use std::ffi::c_void;

use crate::{
  Asset, Bundle, BundleGraph, Dependency, Diagnostic, OptimizeResult, Options, ParcelApi,
  ReportEvent, ResolveResult,
};

/// The raw byte `parcel_plugin_init()` returns, one of `PARCEL_INIT_*`. Parcel
/// reads it as a byte because an unknown value would be undefined behavior to
/// read as the enum.
pub type InitStatusFFI = u8;

/// `parcel_plugin_init()`: called once for each .parcelrc entry naming the
/// plugin, with that entry's options as JSON in `config`, before any other entry
/// point. It may be called concurrently, and always with the same `api` table.
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
  diagnostic: *mut Diagnostic,
) -> InitStatusFFI;

/// `parcel_plugin_deinit()`: releases `state` once Parcel is done with the
/// entry and none of its other calls is still running. Not called when `state`
/// is NULL. Custom content the plugin created can outlive it, so content
/// callbacks must not rely on `state`.
pub type ParcelPluginDeinitFn = extern "C" fn(state: *mut c_void);

/// `parcel_plugin_transform()`: transforms `asset` in place. The only entry
/// point that receives a mutable `Asset`, valid until it returns. Fill in
/// `diagnostic` to fail.
pub type ParcelPluginTransformFn =
  extern "C" fn(asset: Asset, options: Options, state: *mut c_void, diagnostic: *mut Diagnostic);

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
  diagnostic: *mut Diagnostic,
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
  diagnostic: *mut Diagnostic,
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
  diagnostic: *mut Diagnostic,
);

/// `parcel_plugin_report()`: handles a build event. Log events can arrive from
/// any thread while a build runs, concurrently with each other. A diagnostic is
/// printed rather than failing the build.
pub type ParcelPluginReportFn = extern "C" fn(
  event: *const ReportEvent,
  options: Options,
  state: *mut c_void,
  diagnostic: *mut Diagnostic,
);
