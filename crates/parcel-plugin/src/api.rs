//! Access to the host functions Parcel passes in at initialization.
//!
//! Plugins do not link against Parcel's symbols. Parcel hands the plugin a
//! [`ParcelApi`] table when it calls `parcel_plugin_init`, and every SDK call
//! goes through it.

use std::sync::OnceLock;

use crate::ffi::{PARCEL_ABI_VERSION, ParcelApi, ParcelApiHeader};

static API: OnceLock<&'static ParcelApi> = OnceLock::new();

/// Stores the table Parcel passed to `parcel_plugin_init`. Called by
/// [`register_plugin!`](crate::register_plugin) before anything else.
///
/// Parcel calls `parcel_plugin_init` once per pipeline entry, so this runs more
/// than once whenever the same library appears in a .parcelrc more than once —
/// with a different config each time. That is fine: the table is per-process and
/// identical every time, while the per-entry state is the pointer `Plugin::new`
/// returns. Repeat calls are accepted as long as the table is the same one.
///
/// Two checks happen here, and together they are what makes every later call safe
/// without a per-call check:
///
/// - The ABI version must match. Appending to [`ParcelApi`] never changes the
///   size of an existing field, so a changed signature — on one of those
///   functions or on a plugin entry point — is invisible to the size check below.
/// - The table must be at least as large as the one this plugin was compiled
///   against, since fields are only ever appended. Anything smaller means Parcel
///   never filled in a field the plugin can reach.
///
/// Returns `false` if the table cannot be used, in which case nothing here has
/// been stored and no SDK function may be called. There is deliberately no
/// diagnostic: allocating one goes through the very table being rejected, so
/// `parcel_plugin_init` reports [`InitStatus::Incompatible`] and Parcel writes
/// the message instead.
///
/// # Safety
///
/// `raw` must be the pointer Parcel passed, valid for the life of the process.
pub unsafe fn init_api(raw: *const ParcelApi) -> bool {
  if raw.is_null() {
    return false;
  }

  // Only dereference the header first to avoid UB when the size does not match what we expect.
  let header = unsafe { &*raw.cast::<ParcelApiHeader>() };
  if header.abi != PARCEL_ABI_VERSION || header.size < size_of::<ParcelApi>() {
    return false;
  }

  // get_or_init rather than set: two entries in a .parcelrc can be initialized
  // concurrently, and the loser of that race still has to verify what won. A
  // different table means two Parcel instances are sharing this library, which
  // cannot work — whichever one lost would be calling the other's functions.
  let api = unsafe { &*raw };
  let stored = API.get_or_init(|| api);
  std::ptr::eq(*stored, api)
}

/// The host function table.
///
/// # Panics
///
/// If called before [`init_api`], which `register_plugin!` rules out. The
/// generated entry points catch panics, so this surfaces as a diagnostic.
#[inline]
pub fn api() -> &'static ParcelApi {
  API
    .get()
    .copied()
    .expect("Parcel plugin API used before parcel_plugin_init")
}

/// Resolves a host function from the table Parcel provided.
macro_rules! host {
  ($name:ident) => {
    ($crate::api::api()
      .$name
      .expect(concat!("Parcel did not provide ", stringify!($name))))
  };
}

pub(crate) use host;
