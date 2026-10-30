//! ABI-safe owned byte buffers and their memory-management functions.

use std::path::Path;

// ── Buffer ────────────────────────────────────────────────────────────────────

/// The bytes a plugin passed as `data` and `len`. NULL or 0 is empty.
pub(crate) unsafe fn plugin_bytes<'a>(data: *const u8, len: usize) -> &'a [u8] {
  if data.is_null() || len == 0 {
    return &[];
  }
  unsafe { std::slice::from_raw_parts(data, len) }
}

/// A short string a plugin passed as `data` and `len`, such as a type, pipeline
/// or specifier, or `None` when it is not valid UTF-8. NULL or 0 is empty.
#[inline(always)]
pub(crate) unsafe fn plugin_str<'a>(data: *const u8, len: usize) -> Option<&'a str> {
  std::str::from_utf8(unsafe { plugin_bytes(data, len) }).ok()
}

/// Bytes a plugin promised are UTF-8, by passing them to a `_utf8` function or
/// returning them in a `Buffer` with `is_utf8` set.
#[inline(always)]
pub(crate) unsafe fn trusted_utf8(bytes: Vec<u8>, from: &str) -> String {
  // Debug builds check anyway, to catch an SDK that breaks the contract.
  debug_assert!(
    std::str::from_utf8(&bytes).is_ok(),
    "{from} was given invalid UTF-8, breaking the plugin ABI's contract"
  );
  unsafe { String::from_utf8_unchecked(bytes) }
}

/// Like [`trusted_utf8`], for a borrowed slice.
#[inline(always)]
pub(crate) unsafe fn trusted_str<'a>(bytes: &'a [u8], from: &str) -> &'a str {
  debug_assert!(
    std::str::from_utf8(bytes).is_ok(),
    "{from} was given invalid UTF-8, breaking the plugin ABI's contract"
  );
  unsafe { std::str::from_utf8_unchecked(bytes) }
}

/// A path a plugin returned in a `Buffer`, or `None` when it is not one this
/// platform can represent.
///
/// With `is_utf8` set it is trusted like any other UTF-8 buffer. Otherwise any
/// bytes are a path on Unix, where paths are bytes, while elsewhere they must be
/// UTF-8: Rust's own encoding of non-Unicode Windows paths is internal to Rust,
/// not something another language can produce.
pub(crate) unsafe fn plugin_path<'a>(bytes: &'a [u8], is_utf8: bool) -> Option<&'a Path> {
  if is_utf8 {
    return Some(Path::new(unsafe { trusted_str(bytes, "A plugin path") }));
  }
  #[cfg(unix)]
  {
    use std::os::unix::ffi::OsStrExt;
    Some(Path::new(std::ffi::OsStr::from_bytes(bytes)))
  }
  #[cfg(not(unix))]
  {
    std::str::from_utf8(bytes).ok().map(Path::new)
  }
}

/// Byte buffer owned by Parcel.
/// Plugins may allocate a buffer with `parcel_buffer_alloc` and release with `parcel_free_buffer()`.
/// Use `parcel_buffer_write` or `parcel_buffer_write_utf8` to copy data into an existing Buffer,
/// replacing and dropping the existing content if any. Do not set the fields in this struct manually.
///
/// `is_utf8` is a promise that `data` is valid UTF-8. Parcel relies on it without checking, so a
/// buffer a plugin returns with it set (via `parcel_buffer_write_utf8()`) must hold valid UTF-8,
/// and returning one that does not is undefined behavior.
#[repr(C)]
#[derive(Default)]
pub struct Buffer {
  pub data: *mut u8,
  pub len: usize,
  pub cap: usize,
  pub is_utf8: bool,
}

pub(crate) unsafe fn write_buffer(buffer: *mut Buffer, mut bytes: Vec<u8>, is_utf8: bool) {
  unsafe {
    (*buffer).data = bytes.as_mut_ptr();
    (*buffer).len = bytes.len();
    (*buffer).cap = bytes.capacity();
    (*buffer).is_utf8 = is_utf8;
  }
  std::mem::forget(bytes);
}
// ── Buffer functions ──────────────────────────────────────────────────────────

/// Release a `Buffer` previously filled by a getter or `parcel_buffer_alloc()`.
pub extern "C" fn parcel_free_buffer(buf: *mut Buffer) {
  if buf.is_null() {
    return;
  }
  let b = unsafe { &*buf };
  if !b.data.is_null() {
    drop(unsafe { Vec::from_raw_parts(b.data, b.len, b.cap) });
  }
}

/// Allocates a new `Buffer` containing a copy of `[data, data+len)`.
/// The plugin calls this to fill `ResolveResult` or `DiagnosticOptions` fields.
/// Returns a zero `Buffer` when `data` is NULL or `len` is 0.
pub extern "C" fn parcel_buffer_alloc(data: *const u8, len: usize) -> Buffer {
  let mut buf = Buffer::default();
  parcel_buffer_write(&mut buf, data, len);
  buf
}

/// Copies the given bytes into a `Buffer`, replacing the existing content if any.
pub extern "C" fn parcel_buffer_write(buf: *mut Buffer, data: *const u8, len: usize) {
  parcel_buffer_write_inner(buf, data, len, false);
}

/// Copies the given UTF-8 encoded string into a `Buffer`, replacing the existing content if any.
///
/// `data` must be valid UTF-8. Parcel does not check, and passing anything else is undefined
/// behavior. Use `parcel_buffer_write()` for bytes you have not validated; Parcel then checks them
/// itself, and only where it needs text.
pub extern "C" fn parcel_buffer_write_utf8(buf: *mut Buffer, data: *const u8, len: usize) {
  parcel_buffer_write_inner(buf, data, len, true);
}

fn parcel_buffer_write_inner(buf: *mut Buffer, data: *const u8, len: usize, is_utf8: bool) {
  if buf.is_null() || data.is_null() {
    return;
  }

  unsafe {
    let buf = &mut *buf;
    if len == 0 {
      if !buf.data.is_null() {
        parcel_free_buffer(buf as *mut Buffer);
        buf.data = std::ptr::null_mut();
        buf.len = 0;
        buf.cap = 0;
        buf.is_utf8 = false;
      }
      return;
    }

    let slice = std::slice::from_raw_parts(data, len);
    let vec = if !buf.data.is_null() {
      // Reuse the existing allocation.
      let mut vec = Vec::from_raw_parts(buf.data, buf.len, buf.cap);
      vec.clear();
      vec.extend_from_slice(slice);
      vec
    } else {
      slice.to_vec()
    };

    write_buffer(buf as *mut Buffer, vec, is_utf8)
  }
}
