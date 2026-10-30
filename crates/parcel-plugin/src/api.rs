//! Access to the host functions Parcel passes in at initialization.
//!
//! Plugins do not link against Parcel's symbols. Parcel hands the plugin a
//! [`ParcelApi`] table when it calls `parcel_plugin_init`, and every SDK call
//! goes through it.

use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};

use crate::ffi::{PARCEL_ABI_VERSION, PARCEL_API_MIN_SIZE, ParcelApi, ParcelApiHeader};

/// The table Parcel passed, which may be shorter than [`ParcelApi`]: an older
/// Parcel predates the functions appended since. It is kept as a raw pointer for
/// that reason, since a `&ParcelApi` would claim every field is there to read.
static API: AtomicPtr<ParcelApi> = AtomicPtr::new(ptr::null_mut());

/// Stores the table Parcel passed to `parcel_plugin_init`. Called by
/// [`register_plugin!`](crate::register_plugin) before anything else.
///
/// Parcel calls `parcel_plugin_init` once per pipeline entry, so this runs more
/// than once whenever the same library appears in a .parcelrc more than once —
/// with a different config each time. That is fine: the table is per-process and
/// identical every time, while the per-entry state is the pointer `Plugin::new`
/// returns. Repeat calls are accepted as long as the table is the same one.
///
/// The ABI version must match. Appending to [`ParcelApi`] never changes the size
/// of an existing field, so a changed signature — on one of those functions or on
/// a plugin entry point — is invisible to `size`. The table only has to reach the
/// end of the first layout, since every function appended after it is checked
/// against `size` when it is called (see `host!`). A plugin built against a newer
/// SDK therefore still loads on an older Parcel, and only fails if it calls a
/// function that Parcel lacks.
///
/// Returns `false` if the table cannot be used, in which case nothing here has
/// been stored and no SDK function may be called. There is deliberately no
/// diagnostic: allocating one goes through the very table being rejected, so
/// `parcel_plugin_init` reports `InitStatus::Incompatible` and Parcel writes the
/// message instead.
///
/// # Safety
///
/// `raw` must be the pointer Parcel passed, valid for the life of the process.
pub unsafe fn init_api(raw: *const ParcelApi) -> bool {
  if raw.is_null() {
    return false;
  }

  // Every table starts with the header, whatever else it is missing.
  let header = unsafe { raw.cast::<ParcelApiHeader>().read() };
  if header.abi != PARCEL_ABI_VERSION || header.size < PARCEL_API_MIN_SIZE {
    return false;
  }

  // A compare-exchange rather than a store: two entries in a .parcelrc can be
  // initialized concurrently, and the loser of that race still has to verify
  // what won. A different table means two Parcel instances are sharing this
  // library, which cannot work — whichever one lost would be calling the other's
  // functions.
  let raw = raw.cast_mut();
  match API.compare_exchange(ptr::null_mut(), raw, Ordering::AcqRel, Ordering::Acquire) {
    Ok(_) => true,
    Err(installed) => installed == raw,
  }
}

/// The host function table. Read fields through [`host!`] or [`host_opt!`],
/// which check that the table has them.
///
/// # Panics
///
/// If called before [`init_api`], which `register_plugin!` rules out. The
/// generated entry points catch panics, so this surfaces as a diagnostic.
#[inline]
pub(crate) fn api() -> *const ParcelApi {
  let api = API.load(Ordering::Acquire);
  assert!(
    !api.is_null(),
    "Parcel plugin API used before parcel_plugin_init"
  );
  api
}

/// Whether a table of `size` bytes has the function at `offset`. Functions in
/// the first layout are in every table, and since both arguments are constants
/// for them, the check compiles away.
#[inline(always)]
pub(crate) const fn table_has(size: usize, offset: usize) -> bool {
  offset < PARCEL_API_MIN_SIZE || offset + size_of::<usize>() <= size
}

#[cold]
#[inline(never)]
pub(crate) fn missing(name: &str) -> ! {
  panic!(
    "This plugin needs a newer version of Parcel: it calls {name}, which this version of \
     Parcel does not provide."
  )
}

/// Resolves a host function from the table Parcel provided, or `None` when that
/// Parcel predates it. For SDK methods that degrade on an older Parcel rather
/// than fail.
macro_rules! host_opt {
  ($name:ident) => {{
    const OFFSET: usize = ::core::mem::offset_of!($crate::ffi::ParcelApi, $name);
    let api = $crate::api::api();
    // Reads through the raw pointer without forming a reference to the table,
    // which may end before fields this build declares. Callers are usually in
    // an unsafe block already, hence the allows.
    #[allow(unused_unsafe)]
    let size = unsafe { (*api).header.size };
    if $crate::api::table_has(size, OFFSET) {
      #[allow(unused_unsafe)]
      let function = unsafe { (&raw const (*api).$name).read() };
      function
    } else {
      None
    }
  }};
}

/// Resolves a host function from the table Parcel provided. Panics, which the
/// entry points report as a diagnostic, when that Parcel predates it.
macro_rules! host {
  ($name:ident) => {
    $crate::api::host_opt!($name).unwrap_or_else(|| $crate::api::missing(stringify!($name)))
  };
}

pub(crate) use host;
pub(crate) use host_opt;

/// `parcel_buffer_write()`, for code `register_plugin!` expands into the plugin
/// crate, where [`host!`] is out of reach.
#[doc(hidden)]
pub unsafe fn buffer_write(buf: *mut crate::ffi::Buffer, data: *const u8, len: usize) {
  unsafe { host!(buffer_write)(buf, data, len) }
}

/// `parcel_buffer_write_utf8()`, for code `register_plugin!` expands into the
/// plugin crate, where [`host!`] is out of reach.
#[doc(hidden)]
pub unsafe fn buffer_write_utf8(buf: *mut crate::ffi::Buffer, data: *const u8, len: usize) {
  unsafe { host!(buffer_write_utf8)(buf, data, len) }
}

#[cfg(test)]
mod tests {
  use std::mem::offset_of;

  use super::*;

  #[test]
  fn first_layout_functions_are_always_present() {
    let offset = offset_of!(ParcelApi, asset_get_map);
    assert!(table_has(PARCEL_API_MIN_SIZE, offset));
    assert!(table_has(0, offset_of!(ParcelApi, asset_get_content)));
  }

  #[test]
  fn appended_functions_need_a_table_that_reaches_them() {
    // Where the first function appended after the first layout would go.
    let appended = PARCEL_API_MIN_SIZE;
    assert!(!table_has(PARCEL_API_MIN_SIZE, appended));
    assert!(!table_has(appended + size_of::<usize>() - 1, appended));
    assert!(table_has(appended + size_of::<usize>(), appended));
  }

  #[test]
  fn init_accepts_any_table_that_has_the_first_layout() {
    fn table(size: usize, abi: u32) -> *const ParcelApi {
      let mut table: ParcelApi = unsafe { std::mem::zeroed() };
      table.header.size = size;
      table.header.abi = abi;
      Box::into_raw(Box::new(table))
    }

    unsafe {
      assert!(!init_api(ptr::null()));
      assert!(!init_api(table(
        PARCEL_API_MIN_SIZE,
        PARCEL_ABI_VERSION + 1
      )));
      assert!(!init_api(table(
        PARCEL_API_MIN_SIZE - size_of::<usize>(),
        PARCEL_ABI_VERSION
      )));

      // An older Parcel's table, ending at the first layout.
      let old = table(PARCEL_API_MIN_SIZE, PARCEL_ABI_VERSION);
      assert!(init_api(old));
      assert!(init_api(old), "the same table again");
      assert!(
        !init_api(table(size_of::<ParcelApi>(), PARCEL_ABI_VERSION)),
        "a second Parcel's table"
      );
    }
  }
}
