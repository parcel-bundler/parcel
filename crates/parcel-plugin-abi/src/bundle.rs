//! Read-only bundle accessors, flags, and behavior.

// BundleBehavior
use std::sync::Arc;

use parcel_core::{BundleBehavior as CoreBundleBehavior, BundleFlags as CoreBundleFlags};

use crate::{AssetIndex, Buffer, Bundle, PARCEL_INVALID_ASSET_INDEX, Target, write_buffer};

#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum BundleBehavior {
  PARCEL_BUNDLE_BEHAVIOR_NONE = 0,
  PARCEL_BUNDLE_BEHAVIOR_INLINE = 1,
  PARCEL_BUNDLE_BEHAVIOR_ISOLATED = 2,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum BundleFlags {
  PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME = 1 << 0,
  PARCEL_BUNDLE_FLAG_IS_SPLITTABLE = 1 << 1,
  PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER = 1 << 2,
  PARCEL_BUNDLE_FLAG_ENTRY = 1 << 3,
}

pub type BundleFlagsFFI = u8;
const _: () = debug_assert!(
  CoreBundleFlags::NEEDS_STABLE_NAME.bits()
    == BundleFlags::PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME as u8
);
const _: () = debug_assert!(
  CoreBundleFlags::IS_SPLITTABLE.bits() == BundleFlags::PARCEL_BUNDLE_FLAG_IS_SPLITTABLE as u8
);
const _: () = debug_assert!(
  CoreBundleFlags::IS_PLACEHOLDER.bits() == BundleFlags::PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER as u8
);
const _: () =
  debug_assert!(CoreBundleFlags::ENTRY.bits() == BundleFlags::PARCEL_BUNDLE_FLAG_ENTRY as u8);
// ── Bundle (read-only) ───────────────────────────────────────────────────────

/// Returns the bundle type extension (for example, `"js"`) into `*buf`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_type(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  unsafe { write_buffer(buf, bundle.ty.extension().as_bytes().to_vec(), true) };
}

/// Returns the bundle target as a borrowed handle.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_target(bundle: Bundle) -> Target {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  Arc::as_ptr(&bundle.target) as Target
}

/// Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_bundle_behavior(bundle: Bundle) -> BundleBehavior {
  if bundle == 0 {
    return BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  match bundle.bundle_behavior {
    CoreBundleBehavior::None => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_NONE,
    CoreBundleBehavior::Inline => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_INLINE,
    CoreBundleBehavior::Isolated => BundleBehavior::PARCEL_BUNDLE_BEHAVIOR_ISOLATED,
  }
}

/// Returns the raw `BundleFlags` bitfield (`PARCEL_BUNDLE_FLAG_*` bits).
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_flags(bundle: Bundle) -> BundleFlagsFFI {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle.flags.bits()
}

/// Returns the absolute output path into `*buf`, or leaves it empty when unnamed.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_dist_path(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  let Some(path) = bundle.dist_path else {
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

#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_asset_count(bundle: Bundle) -> usize {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle.assets.len()
}

/// Returns an asset index, or `PARCEL_INVALID_ASSET_INDEX` when out of bounds.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_asset(bundle: Bundle, index: usize) -> AssetIndex {
  if bundle == 0 {
    return PARCEL_INVALID_ASSET_INDEX;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle
    .assets
    .get(index)
    .map_or(PARCEL_INVALID_ASSET_INDEX, |asset| asset.0)
}

#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_entry_asset_count(bundle: Bundle) -> usize {
  if bundle == 0 {
    return 0;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle.entry_assets.len()
}

/// Returns an entry asset index, or `PARCEL_INVALID_ASSET_INDEX` when out of bounds.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_entry_asset(bundle: Bundle, index: usize) -> AssetIndex {
  if bundle == 0 {
    return PARCEL_INVALID_ASSET_INDEX;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle
    .entry_assets
    .get(index)
    .map_or(PARCEL_INVALID_ASSET_INDEX, |asset| asset.0)
}

/// Returns the main entry asset, or `PARCEL_INVALID_ASSET_INDEX` when absent.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_main_entry_asset(bundle: Bundle) -> AssetIndex {
  if bundle == 0 {
    return PARCEL_INVALID_ASSET_INDEX;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  bundle
    .main_entry_asset
    .map_or(PARCEL_INVALID_ASSET_INDEX, |asset| asset.0)
}

/// Returns the dist-relative bundle name into `*buf`, or leaves it empty when unnamed.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_name(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  if bundle.dist_path.is_some() {
    unsafe { write_buffer(buf, bundle.name().into_bytes(), true) };
  }
}

/// Returns the public bundle URL into `*buf`, or leaves it empty when unnamed.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_absolute_url(buf: *mut Buffer, bundle: Bundle) {
  if buf.is_null() || bundle == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  if bundle.dist_path.is_some() {
    unsafe { write_buffer(buf, bundle.absolute_url().into_bytes(), true) };
  }
}

/// Returns `bundle`'s URL relative to `from`, or leaves `*buf` empty when unavailable.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_relative_url(buf: *mut Buffer, bundle: Bundle, from: Bundle) {
  if buf.is_null() || bundle == 0 || from == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  let from: &parcel_core::Bundle = unsafe { &*(from as *const parcel_core::Bundle) };
  if let Some(url) = bundle.relative_url(from) {
    unsafe { write_buffer(buf, url.into_bytes(), true) };
  }
}

/// Returns `bundle`'s module specifier relative to `from`, or leaves `*buf` empty when unavailable.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_bundle_get_relative_specifier(
  buf: *mut Buffer,
  bundle: Bundle,
  from: Bundle,
) {
  if buf.is_null() || bundle == 0 || from == 0 {
    return;
  }
  let bundle: &parcel_core::Bundle = unsafe { &*(bundle as *const parcel_core::Bundle) };
  let from: &parcel_core::Bundle = unsafe { &*(from as *const parcel_core::Bundle) };
  if let Some(specifier) = bundle.relative_specifier(from) {
    unsafe { write_buffer(buf, specifier.into_bytes(), true) };
  }
}
