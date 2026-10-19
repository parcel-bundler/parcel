//! File system access for plugins.
//!
//! Every function here goes through the file system Parcel handed the current
//! transform or resolve call, which records each path it touches. A file a plugin
//! reads this way invalidates the asset being processed when it changes, and a
//! file the plugin looked for but did not find invalidates it when created — so
//! watch mode and the cache stay correct without the plugin tracking anything
//! itself. Reading with the plugin's own file APIs instead would work once, and
//! then serve stale output forever.
//!
//! Only transform and resolve calls have such a file system. Called from any
//! other entry point, these functions report `PARCEL_IO_ERROR`.

use parcel_core::{FileKind as CoreFileKind, PathId};

use crate::{Buffer, Options, bytes_to_str, options_context, write_buffer};

/// Outcome of a file system call.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum IoStatus {
  /// The call succeeded and its result is in the output buffer.
  PARCEL_IO_OK = 0,
  /// The path does not exist. The output buffer is left empty.
  PARCEL_IO_NOT_FOUND = 1,
  /// Any other failure. The output buffer holds a UTF-8 description of it.
  PARCEL_IO_ERROR = 2,
}

/// What a path refers to. Empty when it does not exist.
#[repr(u8)]
#[derive(Debug, Clone, Copy, Hash)]
pub enum FileKind {
  PARCEL_FILE_KIND_FILE = 1 << 0,
  PARCEL_FILE_KIND_DIR = 1 << 1,
  PARCEL_FILE_KIND_SYMLINK = 1 << 2,
}

pub type FileKindFFI = u8;

assert_flag_values! {
  core = CoreFileKind,
  abi = FileKind,
  repr = u8;
  flags = {
    IS_FILE => PARCEL_FILE_KIND_FILE,
    IS_DIR => PARCEL_FILE_KIND_DIR,
    IS_SYMLINK => PARCEL_FILE_KIND_SYMLINK,
  }
}

/// Interns a plugin-supplied path, rejecting anything Parcel could not have
/// produced itself: a relative path has no meaning without a base the host
/// cannot guess, and an empty one is what invalid UTF-8 decodes to.
pub(crate) unsafe fn path_arg(path: *const u8, path_len: usize) -> Option<PathId> {
  let path = unsafe { bytes_to_str(path, path_len) };
  let path = std::path::Path::new(path);
  path.is_absolute().then(|| PathId::new(path))
}

unsafe fn write_error(buf: *mut Buffer, message: String) -> IoStatus {
  unsafe { write_buffer(buf, message.into_bytes(), true) };
  IoStatus::PARCEL_IO_ERROR
}

const NO_FS: &str = "File system access is only available while transforming or resolving";

/// Reads the file at the absolute `path` into `*buf`.
///
/// Caller must `parcel_free_buffer(buf)` unless the result is
/// `PARCEL_IO_NOT_FOUND`.
pub extern "C" fn parcel_fs_read_file(
  buf: *mut Buffer,
  options: Options,
  path: *const u8,
  path_len: usize,
) -> IoStatus {
  if buf.is_null() || options == 0 {
    return IoStatus::PARCEL_IO_ERROR;
  }
  let Some(fs) = unsafe { options_context(options) }.fs() else {
    return unsafe { write_error(buf, NO_FS.into()) };
  };
  let Some(path) = (unsafe { path_arg(path, path_len) }) else {
    return unsafe { write_error(buf, "Expected an absolute path".into()) };
  };

  match fs.read(path) {
    Ok(contents) => {
      unsafe { write_buffer(buf, contents, false) };
      IoStatus::PARCEL_IO_OK
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => IoStatus::PARCEL_IO_NOT_FOUND,
    Err(err) => unsafe { write_error(buf, format!("Could not read {:?}: {err}", path)) },
  }
}

/// Returns what the absolute `path` refers to. Returns no flags if it does not
/// exist, or if the file system is unavailable.
pub extern "C" fn parcel_fs_get_kind(
  options: Options,
  path: *const u8,
  path_len: usize,
) -> FileKindFFI {
  if options == 0 {
    return 0;
  }
  let Some(fs) = unsafe { options_context(options) }.fs() else {
    return 0;
  };
  let Some(path) = (unsafe { path_arg(path, path_len) }) else {
    return 0;
  };
  fs.kind(path).bits()
}

/// Writes the canonical form of the absolute `path`, with every symlink
/// resolved, into `*buf`.
///
/// Caller must `parcel_free_buffer(buf)` unless the result is
/// `PARCEL_IO_NOT_FOUND`.
pub extern "C" fn parcel_fs_canonicalize(
  buf: *mut Buffer,
  options: Options,
  path: *const u8,
  path_len: usize,
) -> IoStatus {
  if buf.is_null() || options == 0 {
    return IoStatus::PARCEL_IO_ERROR;
  }
  let Some(fs) = unsafe { options_context(options) }.fs() else {
    return unsafe { write_error(buf, NO_FS.into()) };
  };
  let Some(path) = (unsafe { path_arg(path, path_len) }) else {
    return unsafe { write_error(buf, "Expected an absolute path".into()) };
  };

  match fs.canonicalize(path) {
    Ok(canonical) => {
      let canonical = canonical.to_path_buf().to_string_lossy().into_owned();
      unsafe { write_buffer(buf, canonical.into_bytes(), true) };
      IoStatus::PARCEL_IO_OK
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => IoStatus::PARCEL_IO_NOT_FOUND,
    Err(err) => unsafe { write_error(buf, format!("Could not canonicalize {:?}: {err}", path)) },
  }
}
