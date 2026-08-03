//! The table of host functions passed to a plugin at initialization.
//!
//! Plugins do not link against Parcel's symbols. A shared library cannot resolve
//! undefined symbols against the process that loads it on Windows, and doing so on
//! macOS and Linux required linker flags every plugin crate had to opt into. Parcel
//! hands the plugin this struct instead, and the SDKs call through it.
//!
//! Fields are only ever appended, and a plugin verifies two things at startup:
//!
//! - `size`, against the size of the struct the plugin itself was built against.
//!   A plugin built for a newer Parcel refuses to load rather than reading a
//!   field the host never wrote.
//! - `abi`, against [`PARCEL_ABI_VERSION`]. Appending cannot change the size of
//!   an existing field, so a changed signature — on one of these functions or on
//!   a plugin entry point — is invisible to the size check. That is what the
//!   version number is for, and why both checks are needed.
//!
//! Adding a host function means adding it here too. The test at the bottom of
//! this file fails if the table and the crate's exported functions drift apart.
//! The C wrappers in `plugin.h` and the Go SDK are generated from this struct by
//! build.rs.

use std::ffi::c_void;

use crate::*;

/// The plugin ABI implemented by this build of Parcel.
///
/// Bumped whenever a change would make an existing plugin binary unsafe to load:
/// a changed or removed [`ParcelApi`] field, or a changed plugin entry point
/// signature. Appending to `ParcelApi` is compatible in both directions and does
/// not bump it — the `size` field covers that case.
///
/// Bumping this invalidates every plugin ever built, so prefer appending. To give
/// a host function a different signature, append a new field and leave the old one
/// pointing at a shim: `abi` stays put and existing plugins keep working across
/// the upgrade. That leaves plugin entry point signatures, which are not in this
/// table, as about the only thing a bump is genuinely needed for.
///
/// A published plugin repeats this in its package.json as `parcel.abi`, which
/// lets Parcel reject a mismatch before opening the library. That copy is
/// human-written metadata; the authoritative check is the one the plugin makes
/// against this field.
pub const PARCEL_ABI_VERSION: u32 = 1;

#[repr(C)]
pub struct ParcelApiHeader {
  /// `size_of::<ParcelApi>()` as the host was built. Always the first member.
  pub size: usize,
  /// [`PARCEL_ABI_VERSION`] as the host was built.
  pub abi: u32,
  /// Room for a minor version, should appended functions ever need to be
  /// detectable by something more readable than `size`.
  pub _reserved: u32,
}

/// The host functions available to a plugin.
#[repr(C)]
pub struct ParcelApi {
  /// Size and abi version. Always the first member.
  pub header: ParcelApiHeader,
  pub asset_get_content: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset),
  pub asset_get_content_utf8: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset),
  pub asset_set_content: unsafe extern "C" fn(asset: Asset, data: *const u8, len: u32),
  pub asset_set_content_utf8: unsafe extern "C" fn(asset: Asset, data: *const u8, len: u32),
  pub asset_set_custom_content: unsafe extern "C" fn(
    asset: Asset,
    ty: *const [u8; 16],
    content: *mut c_void,
    read: Option<
      extern "C" fn(content: *const c_void, buf: *mut Buffer, diagnostic: *mut Diagnostic),
    >,
    package: Option<
      extern "C" fn(
        content: *const c_void,
        bundle_graph: BundleGraph,
        bundle: Bundle,
        options: Options,
        buf: *mut Buffer,
        diagnostic: *mut Diagnostic,
      ),
    >,
    free: Option<extern "C" fn(content: *mut c_void)>,
  ),
  pub asset_get_custom_content:
    unsafe extern "C" fn(ty: *mut [u8; 16], content: *mut *mut c_void, asset: Asset) -> bool,
  pub asset_get_type: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset),
  pub asset_set_type: unsafe extern "C" fn(asset: Asset, ty: *const u8, ty_len: usize),
  pub asset_get_file_path: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset, _options: Options),
  pub asset_get_pipeline: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset),
  pub asset_set_pipeline:
    unsafe extern "C" fn(asset: Asset, pipeline: *const u8, pipeline_len: usize),
  pub asset_get_bundle_behavior: unsafe extern "C" fn(asset: Asset) -> BundleBehavior,
  pub asset_set_bundle_behavior: unsafe extern "C" fn(asset: Asset, behavior: BundleBehavior),
  pub asset_get_flags: unsafe extern "C" fn(asset: Asset) -> AssetFlagsFFI,
  pub asset_set_flags: unsafe extern "C" fn(asset: Asset, flags: AssetFlagsFFI),
  pub asset_get_unique_key: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset),
  pub asset_set_unique_key: unsafe extern "C" fn(asset: Asset, key: *const u8, key_len: usize),
  pub asset_add_export_symbol: unsafe extern "C" fn(asset: Asset, name: *const u8, name_len: usize),
  pub free_buffer: unsafe extern "C" fn(buf: *mut Buffer),
  pub buffer_alloc: unsafe extern "C" fn(data: *const u8, len: usize) -> Buffer,
  pub buffer_write: unsafe extern "C" fn(buf: *mut Buffer, data: *const u8, len: usize),
  pub buffer_write_utf8: unsafe extern "C" fn(buf: *mut Buffer, data: *const u8, len: usize),
  pub bundle_get_type: unsafe extern "C" fn(buf: *mut Buffer, bundle: Bundle),
  pub bundle_get_target: unsafe extern "C" fn(bundle: Bundle) -> Target,
  pub bundle_get_bundle_behavior: unsafe extern "C" fn(bundle: Bundle) -> BundleBehavior,
  pub bundle_get_flags: unsafe extern "C" fn(bundle: Bundle) -> BundleFlagsFFI,
  pub bundle_get_dist_path: unsafe extern "C" fn(buf: *mut Buffer, bundle: Bundle),
  pub bundle_get_asset_count: unsafe extern "C" fn(bundle: Bundle) -> usize,
  pub bundle_get_asset: unsafe extern "C" fn(bundle: Bundle, index: usize) -> AssetIndex,
  pub bundle_get_entry_asset_count: unsafe extern "C" fn(bundle: Bundle) -> usize,
  pub bundle_get_entry_asset: unsafe extern "C" fn(bundle: Bundle, index: usize) -> AssetIndex,
  pub bundle_get_main_entry_asset: unsafe extern "C" fn(bundle: Bundle) -> AssetIndex,
  pub bundle_get_name: unsafe extern "C" fn(buf: *mut Buffer, bundle: Bundle),
  pub bundle_get_absolute_url: unsafe extern "C" fn(buf: *mut Buffer, bundle: Bundle),
  pub bundle_get_relative_url: unsafe extern "C" fn(buf: *mut Buffer, bundle: Bundle, from: Bundle),
  pub bundle_get_relative_specifier:
    unsafe extern "C" fn(buf: *mut Buffer, bundle: Bundle, from: Bundle),
  pub bundle_graph_get_asset_count: unsafe extern "C" fn(bundle_graph: BundleGraph) -> usize,
  pub bundle_graph_get_asset:
    unsafe extern "C" fn(bundle_graph: BundleGraph, index: AssetIndex) -> Asset,
  pub bundle_graph_get_bundle_count: unsafe extern "C" fn(bundle_graph: BundleGraph) -> usize,
  pub bundle_graph_get_bundle:
    unsafe extern "C" fn(bundle_graph: BundleGraph, index: BundleIndex) -> Bundle,
  pub bundle_graph_get_dependency_resolution:
    unsafe extern "C" fn(
      bundle_graph: BundleGraph,
      asset: AssetIndex,
      dependency_index: usize,
    ) -> BundleGraphDependencyResolution,
  pub asset_get_dependency_count: unsafe extern "C" fn(asset: Asset) -> usize,
  pub asset_get_dependency: unsafe extern "C" fn(asset: Asset, index: usize) -> Dependency,
  pub asset_add_dependency: unsafe extern "C" fn(asset: Asset, dep: *const DependencyOptions),
  pub dep_get_specifier: unsafe extern "C" fn(buf: *mut Buffer, dep: Dependency),
  pub dep_get_specifier_type: unsafe extern "C" fn(dep: Dependency) -> SpecifierType,
  pub dep_get_priority: unsafe extern "C" fn(dep: Dependency) -> Priority,
  pub dep_get_bundle_behavior: unsafe extern "C" fn(dep: Dependency) -> BundleBehavior,
  pub dep_get_flags: unsafe extern "C" fn(dep: Dependency) -> DependencyFlagsFFI,
  pub dep_get_conditions: unsafe extern "C" fn(dep: Dependency) -> ExportsConditionsFFI,
  pub dep_get_source_path:
    unsafe extern "C" fn(buf: *mut Buffer, dep: Dependency, _options: Options),
  pub dep_get_resolve_from:
    unsafe extern "C" fn(buf: *mut Buffer, dep: Dependency, _options: Options),
  pub dep_get_target: unsafe extern "C" fn(dep: Dependency) -> Target,
  pub options_get_project_root: unsafe extern "C" fn(buf: *mut Buffer, options: Options),
  pub options_get_env:
    unsafe extern "C" fn(buf: *mut Buffer, options: Options, key: *const u8, key_len: usize),
  pub asset_get_target: unsafe extern "C" fn(asset: Asset) -> Target,
  pub target_get_environment: unsafe extern "C" fn(target: Target) -> Environment,
  pub target_get_output_format: unsafe extern "C" fn(target: Target) -> OutputFormat,
  pub target_get_source_type: unsafe extern "C" fn(target: Target) -> SourceType,
  pub target_get_env_flags: unsafe extern "C" fn(target: Target) -> EnvironmentFlagsFFI,
  pub target_get_public_url: unsafe extern "C" fn(buf: *mut Buffer, target: Target),
  pub target_get_dist_dir:
    unsafe extern "C" fn(buf: *mut Buffer, target: Target, _options: Options),
  pub asset_get_query: unsafe extern "C" fn(buf: *mut Buffer, asset: Asset),
}

/// The instance passed to every plugin. Const-initialized, so it is in the
/// binary's image before the process starts and needs no synchronization.
pub static PARCEL_API: ParcelApi = ParcelApi {
  header: ParcelApiHeader {
    size: size_of::<ParcelApi>(),
    abi: PARCEL_ABI_VERSION,
    _reserved: 0,
  },
  asset_get_content: parcel_asset_get_content,
  asset_get_content_utf8: parcel_asset_get_content_utf8,
  asset_set_content: parcel_asset_set_content,
  asset_set_content_utf8: parcel_asset_set_content_utf8,
  asset_set_custom_content: parcel_asset_set_custom_content,
  asset_get_custom_content: parcel_asset_get_custom_content,
  asset_get_type: parcel_asset_get_type,
  asset_set_type: parcel_asset_set_type,
  asset_get_file_path: parcel_asset_get_file_path,
  asset_get_pipeline: parcel_asset_get_pipeline,
  asset_set_pipeline: parcel_asset_set_pipeline,
  asset_get_bundle_behavior: parcel_asset_get_bundle_behavior,
  asset_set_bundle_behavior: parcel_asset_set_bundle_behavior,
  asset_get_flags: parcel_asset_get_flags,
  asset_set_flags: parcel_asset_set_flags,
  asset_get_unique_key: parcel_asset_get_unique_key,
  asset_set_unique_key: parcel_asset_set_unique_key,
  asset_add_export_symbol: parcel_asset_add_export_symbol,
  free_buffer: parcel_free_buffer,
  buffer_alloc: parcel_buffer_alloc,
  buffer_write: parcel_buffer_write,
  buffer_write_utf8: parcel_buffer_write_utf8,
  bundle_get_type: parcel_bundle_get_type,
  bundle_get_target: parcel_bundle_get_target,
  bundle_get_bundle_behavior: parcel_bundle_get_bundle_behavior,
  bundle_get_flags: parcel_bundle_get_flags,
  bundle_get_dist_path: parcel_bundle_get_dist_path,
  bundle_get_asset_count: parcel_bundle_get_asset_count,
  bundle_get_asset: parcel_bundle_get_asset,
  bundle_get_entry_asset_count: parcel_bundle_get_entry_asset_count,
  bundle_get_entry_asset: parcel_bundle_get_entry_asset,
  bundle_get_main_entry_asset: parcel_bundle_get_main_entry_asset,
  bundle_get_name: parcel_bundle_get_name,
  bundle_get_absolute_url: parcel_bundle_get_absolute_url,
  bundle_get_relative_url: parcel_bundle_get_relative_url,
  bundle_get_relative_specifier: parcel_bundle_get_relative_specifier,
  bundle_graph_get_asset_count: parcel_bundle_graph_get_asset_count,
  bundle_graph_get_asset: parcel_bundle_graph_get_asset,
  bundle_graph_get_bundle_count: parcel_bundle_graph_get_bundle_count,
  bundle_graph_get_bundle: parcel_bundle_graph_get_bundle,
  bundle_graph_get_dependency_resolution: parcel_bundle_graph_get_dependency_resolution,
  asset_get_dependency_count: parcel_asset_get_dependency_count,
  asset_get_dependency: parcel_asset_get_dependency,
  asset_add_dependency: parcel_asset_add_dependency,
  dep_get_specifier: parcel_dep_get_specifier,
  dep_get_specifier_type: parcel_dep_get_specifier_type,
  dep_get_priority: parcel_dep_get_priority,
  dep_get_bundle_behavior: parcel_dep_get_bundle_behavior,
  dep_get_flags: parcel_dep_get_flags,
  dep_get_conditions: parcel_dep_get_conditions,
  dep_get_source_path: parcel_dep_get_source_path,
  dep_get_resolve_from: parcel_dep_get_resolve_from,
  dep_get_target: parcel_dep_get_target,
  options_get_project_root: parcel_options_get_project_root,
  options_get_env: parcel_options_get_env,
  asset_get_target: parcel_asset_get_target,
  target_get_environment: parcel_target_get_environment,
  target_get_output_format: parcel_target_get_output_format,
  target_get_source_type: parcel_target_get_source_type,
  target_get_env_flags: parcel_target_get_env_flags,
  target_get_public_url: parcel_target_get_public_url,
  target_get_dist_dir: parcel_target_get_dist_dir,
  asset_get_query: parcel_asset_get_query,
};

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn table_describes_itself() {
    assert_eq!(PARCEL_API.header.size, size_of::<ParcelApi>());
    assert_eq!(PARCEL_API.header.abi, PARCEL_ABI_VERSION);
  }

  /// The two header fields sit before the function pointers and never move, so a
  /// plugin built against any ABI can read them from any host's table. Reordering
  /// them would break the version check itself.
  #[test]
  fn version_fields_come_first() {
    assert_eq!(std::mem::offset_of!(ParcelApi, header), 0);
    assert_eq!(
      std::mem::offset_of!(ParcelApi, header.abi),
      size_of::<usize>(),
      "abi must stay directly after size"
    );
  }

  /// A host function missing from the table is unreachable by every plugin, and
  /// nothing else would catch it: the function still compiles, and the SDKs only
  /// wrap what the table exposes.
  #[test]
  fn every_host_function_is_in_the_table() {
    let exported: usize = [
      include_str!("asset.rs"),
      include_str!("buffer.rs"),
      include_str!("bundle.rs"),
      include_str!("bundle_graph.rs"),
      include_str!("dependency.rs"),
      include_str!("options.rs"),
      include_str!("target.rs"),
    ]
    .iter()
    .map(|source| source.matches("pub extern \"C\" fn parcel_").count())
    .sum();

    // Counted from the layout rather than the source: every field after the
    // header is one function pointer, and this cannot be thrown off by how
    // rustfmt happens to wrap a declaration.
    let header = size_of::<usize>() + 2 * size_of::<u32>();
    let fields = (size_of::<ParcelApi>() - header) / size_of::<*const ()>();

    assert_eq!(
      fields, exported,
      "ParcelApi has {fields} functions but the crate exports {exported}; append \
       the missing ones to ParcelApi"
    );
  }
}
