//! Structs that Parcel and a plugin exchange through a pointer.
//!
//! Each one starts with `size`: `sizeof` the struct as whoever allocated it was
//! built. That lets either side append fields without breaking binaries built
//! against the older layout, in either direction:
//!
//! - **Reading** a struct the other side filled in, copy `min(size, sizeof)`
//!   bytes and leave the rest at their defaults. Fields the writer predates read
//!   as zero, which is why an appended field's zero value must mean "not set".
//!   Fields the reader predates are past its `sizeof`: whether those may be
//!   ignored depends on the struct, and is up to its reader.
//! - **Writing** into a struct the other side allocated, only write fields that
//!   end within its `size`. A field that does not fit is one the allocator has
//!   never heard of.
//!
//! `size` is set by whoever allocates the struct, so it describes the memory
//! actually behind the pointer. An out-param the host allocates carries the
//! host's size, and one a plugin allocates carries the plugin's.
//!
//! Rules for appending a field:
//!
//! - Append only. Never reorder, resize, or remove a field.
//! - Start it at or past the struct's previous `sizeof`, never in its tail
//!   padding: a writer built against the older layout reports the older size,
//!   and leaves that padding uninitialized.
//! - Zero must be its default, since that is what an older writer leaves there.
//! - `MIN_SIZE` stays where it is. It marks the end of the first layout, which
//!   every writer has filled in.
//!
//! [`Buffer`](crate::Buffer) is the exception: it is embedded by value in these
//! structs and returned by value from `parcel_buffer_alloc()`, so its layout is
//! fixed for the life of the ABI.

use std::ptr;

/// A struct whose first field is `size: usize`. See the module docs.
///
/// # Safety
///
/// The implementor must be `#[repr(C)]` and start with a `usize` holding its
/// size, which its `Default` sets to `size_of::<Self>()`.
pub(crate) unsafe trait Extensible: Default {
  /// The end of the last field in the first published layout. A struct
  /// reporting less was not written by any version of the ABI.
  const MIN_SIZE: usize;
}

/// Copies a struct the other side allocated and filled in.
///
/// Fields past the writer's `size` keep their defaults. Returns the copy along
/// with the writer's `size`, which a caller compares against `size_of::<T>()`
/// to find out whether the writer knew about fields this build does not. Returns
/// `None` when `size` is below `T::MIN_SIZE`, e.g. because the writer forgot to
/// set it.
///
/// # Safety
///
/// `src` must be non-null and point to at least `(*src).size` readable bytes.
/// Every field of `T` must be valid for any bit pattern: integers, pointers, and
/// raw enum aliases, never a Rust enum, which an unknown value would make
/// undefined behavior to read.
pub(crate) unsafe fn read_extensible<T: Extensible>(src: *const T) -> Option<(T, usize)> {
  let size = unsafe { src.cast::<usize>().read() };
  if size < T::MIN_SIZE {
    return None;
  }

  let mut value = T::default();
  let len = size.min(size_of::<T>());
  // `size` itself is left at the default: the copy now describes this build's
  // layout, with whatever the writer did not fill in defaulted.
  let header = size_of::<usize>();
  unsafe {
    ptr::copy_nonoverlapping(
      src.cast::<u8>().add(header),
      (&mut value as *mut T).cast::<u8>().add(header),
      len - header,
    )
  };
  Some((value, size))
}

/// Whether every byte of a struct the other side allocated, past the end of
/// `T`, is zero: that is, whether a writer built against a newer layout left
/// every field this build has never heard of at its default.
///
/// # Safety
///
/// `src` must point to at least `size` readable bytes.
pub(crate) unsafe fn unknown_fields_are_zero<T: Extensible>(src: *const T, size: usize) -> bool {
  (size_of::<T>()..size).all(|offset| unsafe { src.cast::<u8>().add(offset).read() } == 0)
}

/// Copies `value` into a struct the other side allocated, leaving its `size`
/// alone and writing only the fields that end within it.
///
/// Returns false, writing nothing, when the destination's `size` is below
/// `T::MIN_SIZE`. `T` must not own anything past `MIN_SIZE`, since a field that
/// does not fit is dropped without being freed.
///
/// # Safety
///
/// `dst` must be non-null and point to at least `(*dst).size` writable bytes.
pub(crate) unsafe fn write_extensible<T: Extensible>(dst: *mut T, value: T) -> bool {
  let size = unsafe { dst.cast::<usize>().read() };
  if size < T::MIN_SIZE {
    return false;
  }

  let header = size_of::<usize>();
  let len = size.min(size_of::<T>());
  unsafe {
    ptr::copy_nonoverlapping(
      (&value as *const T).cast::<u8>().add(header),
      dst.cast::<u8>().add(header),
      len - header,
    )
  };
  std::mem::forget(value);
  true
}

/// Implements [`Extensible`], along with a [`Default`] that zeroes every field
/// except `size`.
macro_rules! impl_extensible {
  ($ty:ty, min_size = $min:expr) => {
    impl Default for $ty {
      fn default() -> Self {
        // Every field is an integer, pointer, or `Buffer`, all of which are
        // valid zeroed, and zero is each field's default.
        let mut value: Self = unsafe { std::mem::zeroed() };
        value.size = size_of::<Self>();
        value
      }
    }

    unsafe impl $crate::extensible::Extensible for $ty {
      const MIN_SIZE: usize = $min;
    }
  };
}
