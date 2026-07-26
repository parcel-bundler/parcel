//! Read-only target and environment accessors.

use std::sync::Arc;

use parcel_core::{Asset as CoreAsset, EnvironmentFlags as CoreEnvironmentFlags};

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

// OutputFormat (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum OutputFormat {
  PARCEL_OUTPUT_FORMAT_GLOBAL = 0,
  PARCEL_OUTPUT_FORMAT_COMMONJS = 1,
  PARCEL_OUTPUT_FORMAT_ESMODULE = 2,
}

// SourceType (target, read-only)
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum SourceType {
  PARCEL_SOURCE_TYPE_MODULE = 0,
  PARCEL_SOURCE_TYPE_SCRIPT = 1,
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
const _: () = debug_assert!(
  CoreEnvironmentFlags::IS_LIBRARY.bits() == EnvironmentFlags::PARCEL_ENV_FLAG_IS_LIBRARY as u8
);
const _: () = debug_assert!(
  CoreEnvironmentFlags::SHOULD_OPTIMIZE.bits()
    == EnvironmentFlags::PARCEL_ENV_FLAG_SHOULD_OPTIMIZE as u8
);
const _: () = debug_assert!(
  CoreEnvironmentFlags::SHOULD_SCOPE_HOIST.bits()
    == EnvironmentFlags::PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST as u8
);
const _: () = debug_assert!(
  CoreEnvironmentFlags::MODULE_TYPE_EXTENSION.bits()
    == EnvironmentFlags::PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION as u8
);
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
  use parcel_core::Environment::*;
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  match target.environment {
    Browser => Environment::PARCEL_ENV_BROWSER,
    WebWorker => Environment::PARCEL_ENV_WEB_WORKER,
    ServiceWorker => Environment::PARCEL_ENV_SERVICE_WORKER,
    Worklet => Environment::PARCEL_ENV_WORKLET,
    Node => Environment::PARCEL_ENV_NODE,
    ElectronMain => Environment::PARCEL_ENV_ELECTRON_MAIN,
    ElectronRenderer => Environment::PARCEL_ENV_ELECTRON_RENDERER,
    ReactClient => Environment::PARCEL_ENV_REACT_CLIENT,
    ReactServer => Environment::PARCEL_ENV_REACT_SERVER,
  }
}

/// Returns the output format (`PARCEL_OUTPUT_FORMAT_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_output_format(target: Target) -> OutputFormat {
  use parcel_core::OutputFormat::*;
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  match target.output_format {
    Global => OutputFormat::PARCEL_OUTPUT_FORMAT_GLOBAL,
    Commonjs => OutputFormat::PARCEL_OUTPUT_FORMAT_COMMONJS,
    Esmodule => OutputFormat::PARCEL_OUTPUT_FORMAT_ESMODULE,
  }
}

/// Returns the source type (`PARCEL_SOURCE_TYPE_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_target_get_source_type(target: Target) -> SourceType {
  use parcel_core::SourceType::*;
  let target: &parcel_core::Target = unsafe { &*(target as *const parcel_core::Target) };
  match target.source_type {
    Module => SourceType::PARCEL_SOURCE_TYPE_MODULE,
    Script => SourceType::PARCEL_SOURCE_TYPE_SCRIPT,
  }
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
