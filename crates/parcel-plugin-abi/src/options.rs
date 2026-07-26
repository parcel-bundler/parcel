//! Read-only Parcel option accessors.

use parcel_core::ParcelOptions;

use crate::{Buffer, Options, bytes_to_str, write_buffer};

// ── Options accessors (read-only) ─────────────────────────────────────────────

/// Returns the project root as an absolute filesystem path into `*buf`.
/// Caller must `parcel_free_buffer(buf)`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_options_get_project_root(buf: *mut Buffer, options: Options) {
  if buf.is_null() {
    return;
  }
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  unsafe {
    write_buffer(
      buf,
      options
        .project_root
        .to_path_buf()
        .to_string_lossy()
        .into_owned()
        .into_bytes(),
      true,
    )
  };
}

/// Looks up `key` in the build environment map.
/// Writes the value into `*buf` if found; leaves `buf->data == NULL` if not.
/// Caller must `parcel_free_buffer(buf)` when `data != NULL`.
#[unsafe(no_mangle)]
pub extern "C" fn parcel_options_get_env(
  buf: *mut Buffer,
  options: Options,
  key: *const u8,
  key_len: usize,
) {
  if buf.is_null() || key.is_null() {
    return;
  }
  let options: &ParcelOptions = unsafe { &*(options as *const ParcelOptions) };
  let key_str = unsafe { bytes_to_str(key, key_len) };
  if let Some(value) = options.env.get(key_str) {
    unsafe { write_buffer(buf, value.as_bytes().to_vec(), true) };
  }
}
