//! Read-only target and environment accessors.

use std::sync::Arc;

use parcel_core::{
  Asset as CoreAsset, Environment as CoreEnvironment, EnvironmentFlags as CoreEnvironmentFlags,
  OutputFormat as CoreOutputFormat, SourceType as CoreSourceType,
};

use crate::{Asset, Buffer, Options, Target, write_buffer};

// Environment (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum Environment {
  PARCEL_ENV_BROWSER = 0,
  PARCEL_ENV_WEB_WORKER = 1,
  PARCEL_ENV_SERVICE_WORKER = 2,
  PARCEL_ENV_WORKLET = 3,
  PARCEL_ENV_NODE = 4,
  PARCEL_ENV_ELECTRON_MAIN = 5,
  PARCEL_ENV_ELECTRON_RENDERER = 6,
  PARCEL_ENV_REACT_CLIENT = 7,
  PARCEL_ENV_REACT_SERVER = 8,
}

impl_enum_conversion! {
  CoreEnvironment => Environment {
    CoreEnvironment::Browser => Environment::PARCEL_ENV_BROWSER,
    CoreEnvironment::WebWorker => Environment::PARCEL_ENV_WEB_WORKER,
    CoreEnvironment::ServiceWorker => Environment::PARCEL_ENV_SERVICE_WORKER,
    CoreEnvironment::Worklet => Environment::PARCEL_ENV_WORKLET,
    CoreEnvironment::Node => Environment::PARCEL_ENV_NODE,
    CoreEnvironment::ElectronMain => Environment::PARCEL_ENV_ELECTRON_MAIN,
    CoreEnvironment::ElectronRenderer => Environment::PARCEL_ENV_ELECTRON_RENDERER,
    CoreEnvironment::ReactClient => Environment::PARCEL_ENV_REACT_CLIENT,
    CoreEnvironment::ReactServer => Environment::PARCEL_ENV_REACT_SERVER,
  }
}

// OutputFormat (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum OutputFormat {
  PARCEL_OUTPUT_FORMAT_GLOBAL = 0,
  PARCEL_OUTPUT_FORMAT_COMMONJS = 1,
  PARCEL_OUTPUT_FORMAT_ESMODULE = 2,
}

impl_enum_conversion! {
  CoreOutputFormat => OutputFormat {
    CoreOutputFormat::Global => OutputFormat::PARCEL_OUTPUT_FORMAT_GLOBAL,
    CoreOutputFormat::Commonjs => OutputFormat::PARCEL_OUTPUT_FORMAT_COMMONJS,
    CoreOutputFormat::Esmodule => OutputFormat::PARCEL_OUTPUT_FORMAT_ESMODULE,
  }
}

// SourceType (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum SourceType {
  PARCEL_SOURCE_TYPE_MODULE = 0,
  PARCEL_SOURCE_TYPE_SCRIPT = 1,
}

impl_enum_conversion! {
  CoreSourceType => SourceType {
    CoreSourceType::Module => SourceType::PARCEL_SOURCE_TYPE_MODULE,
    CoreSourceType::Script => SourceType::PARCEL_SOURCE_TYPE_SCRIPT,
  }
}

// EnvironmentFlags (target, read-only) — bitfield
#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum EnvironmentFlags {
  PARCEL_ENV_FLAG_IS_LIBRARY = 1 << 0,
  PARCEL_ENV_FLAG_SHOULD_OPTIMIZE = 1 << 1,
  PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST = 1 << 2,
  PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION = 1 << 3,
}

pub type EnvironmentFlagsFFI = u8;

assert_flag_values! {
  core = CoreEnvironmentFlags,
  abi = EnvironmentFlags,
  repr = u8;
  flags = {
    IS_LIBRARY => PARCEL_ENV_FLAG_IS_LIBRARY,
    SHOULD_OPTIMIZE => PARCEL_ENV_FLAG_SHOULD_OPTIMIZE,
    SHOULD_SCOPE_HOIST => PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST,
    MODULE_TYPE_EXTENSION => PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION,
  }
}

// ── Target (read-only) ────────────────────────────────────────────────────────

/// Returns an opaque `Target` handle. Valid for the duration of the transform call.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_asset_get_target(asset: Asset) -> Target {
  let asset: &CoreAsset = unsafe { &*(asset as *const CoreAsset) };
  Arc::as_ptr(&asset.target) as u64
}

/// Returns the target environment (`PARCEL_ENV_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_environment(target: Target) -> Environment {
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  target.environment.into()
}

/// Returns the output format (`PARCEL_OUTPUT_FORMAT_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_output_format(target: Target) -> OutputFormat {
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  target.output_format.into()
}

/// Returns the source type (`PARCEL_SOURCE_TYPE_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_source_type(target: Target) -> SourceType {
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  target.source_type.into()
}

/// Returns the `EnvironmentFlags` bitfield (`PARCEL_ENV_FLAG_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_env_flags(target: Target) -> EnvironmentFlagsFFI {
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  target.flags.bits()
}

/// Returns the public URL (e.g. `"/"`) into `*buf`. Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_public_url(buf: *mut Buffer, target: Target) {
  if buf.is_null() {
    return;
  }
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  unsafe { write_buffer(buf, target.public_url.as_bytes().to_vec(), true) };
}

/// Returns the absolute path of the dist directory into `*buf`.
/// `options` is the handle received from `parcel_plugin_transform()`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_dist_dir(buf: *mut Buffer, target: Target, _options: Options) {
  if buf.is_null() {
    return;
  }
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  unsafe {
    write_buffer(
      buf,
      target
        .dist_dir
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}
