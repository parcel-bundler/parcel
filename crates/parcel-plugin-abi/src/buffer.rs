//! ABI-safe owned byte buffers and their memory-management functions.

// ── Buffer ────────────────────────────────────────────────────────────────────

pub(crate) unsafe fn bytes_to_str<'a>(data: *const u8, len: usize) -> &'a str {
  if data.is_null() || len == 0 {
    return "";
  }
  unsafe { std::str::from_utf8(std::slice::from_raw_parts(data, len)).unwrap_or("") }
}

/// Byte buffer owned by Parcel.
/// Plugins may allocate a buffer with `parcel_buffer_alloc` and release with `parcel_free_buffer()`.
/// Use `parcel_buffer_write` or `parcel_buffer_write_utf8` to copy data into an existing Buffer,
/// replacing and dropping the existing content if any. Do not set the fields in this struct manually.
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
/// The plugin calls this to fill `ResolveResult` or `Diagnostic` fields.
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
/// It is the caller's responsibility to ensure that the UTF-8 data is valid.
pub extern "C" fn parcel_buffer_write_utf8(buf: *mut Buffer, data: *const u8, len: usize) {
  parcel_buffer_write_inner(buf, data, len, true);
}

fn parcel_buffer_write_inner(buf: *mut Buffer, data: *const u8, len: usize, is_utf8: bool) {
  if data.is_null() {
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
