use std::{
  io::Result,
  path::{Path, PathBuf},
};

use super::{DirEntry, FileKind, FileStat, FileSystem};

/// Default operating system file system implementation.
#[derive(Default)]
pub struct OsFileSystem;

impl FileSystem for OsFileSystem {
  fn read(&self, path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path)
  }

  fn read_to_string(&self, path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
  }

  fn kind(&self, path: &Path) -> FileKind {
    let mut flags = FileKind::empty();

    // A majority of paths are not symlinks. symlink_metadata will tell us whether a path is a symlink,
    // and if not, also whether the path is a file or directory. If it was a symlink we'll need to make
    // another call to get the metadata of the underlying path, but this is rare.
    if let Ok(metadata) = path.symlink_metadata() {
      if metadata.is_symlink() {
        flags.set(FileKind::IS_SYMLINK, true);
        if let Ok(metadata) = path.metadata() {
          flags.set(FileKind::IS_FILE, metadata.is_file());
          flags.set(FileKind::IS_DIR, metadata.is_dir());
        }
      } else {
        flags.set(FileKind::IS_FILE, metadata.is_file());
        flags.set(FileKind::IS_DIR, metadata.is_dir());
      }
    }

    flags
  }

  fn read_link(&self, path: &Path) -> Result<PathBuf> {
    path.read_link()
  }

  fn canonicalize(&self, path: &Path) -> Result<PathBuf> {
    path.canonicalize()
  }

  fn write(&self, path: &Path, contents: &Vec<u8>) -> Result<()> {
    std::fs::write(path, contents)
  }

  fn copy(&self, from: &Path, to: &Path) -> Result<()> {
    std::fs::copy(from, to).map(|_| ())
  }

  fn remove_file(&self, path: &Path) -> Result<()> {
    std::fs::remove_file(path)
  }

  fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
    let dir = path.read_dir()?;
    let mut entries = Vec::new();
    for ent in dir {
      let ent = ent?;
      let ty = ent.file_type()?;
      let mut kind = FileKind::empty();
      kind.set(FileKind::IS_DIR, ty.is_dir());
      kind.set(FileKind::IS_FILE, ty.is_file());
      kind.set(FileKind::IS_SYMLINK, ty.is_symlink());
      entries.push(DirEntry {
        name: ent.file_name(),
        kind,
      });
    }

    Ok(entries)
  }

  fn create_dir_all(&self, path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)
  }

  fn stat(&self, path: &Path) -> Option<FileStat> {
    path.symlink_metadata().ok().and_then(|meta| {
      let is_symlink = meta.is_symlink();
      let metadata = path.metadata().ok()?;
      Some(FileStat::from_metadata(&metadata, is_symlink))
    })
  }

  fn lstat(&self, path: &Path) -> Option<FileStat> {
    path.symlink_metadata().ok().and_then(|meta| {
      let is_symlink = meta.is_symlink();
      Some(FileStat::from_metadata(&meta, is_symlink))
    })
  }
}
