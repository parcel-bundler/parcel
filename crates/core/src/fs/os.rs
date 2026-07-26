use std::io::Result;

use super::{DirEntry, FileKind, FileStat, FileSystem, normalize_path, resolve_path};
use crate::PathId;

/// Default operating system file system implementation.
#[derive(Default)]
pub struct OsFileSystem;

impl FileSystem for OsFileSystem {
  fn read(&self, path: PathId) -> Result<Vec<u8>> {
    path.with_path(|p| std::fs::read(p))
  }

  fn read_to_string(&self, path: PathId) -> Result<String> {
    path.with_path(|p| std::fs::read_to_string(p))
  }

  fn kind(&self, path: PathId) -> FileKind {
    path.with_path(|path| {
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
    })
  }

  fn read_link(&self, path: PathId) -> Result<PathId> {
    path.with_path(|path| {
      let target = path.read_link()?;
      // Resolve the (possibly relative) link target to an absolute path before interning. A relative
      // target is relative to the directory containing the symlink (`path`'s parent), which is what
      // `resolve_path` computes.
      let resolved = if target.is_absolute() {
        normalize_path(&target)
      } else {
        resolve_path(path, &target)
      };
      Ok(PathId::new(&resolved))
    })
  }

  fn canonicalize(&self, path: PathId) -> Result<PathId> {
    path.with_path(|p| p.canonicalize().map(|c| PathId::new(&c)))
  }

  fn write(&self, path: PathId, contents: &[u8]) -> Result<()> {
    path.with_path(|p| std::fs::write(p, contents))
  }

  fn copy(&self, from: PathId, to: PathId) -> Result<()> {
    from.with_path(|from| to.with_path(|to| std::fs::copy(from, to).map(|_| ())))
  }

  fn remove_file(&self, path: PathId) -> Result<()> {
    path.with_path(|p| std::fs::remove_file(p))
  }

  fn read_dir(&self, path: PathId) -> Result<Vec<DirEntry>> {
    path.with_path(|path| {
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
    })
  }

  fn create_dir_all(&self, path: PathId) -> Result<()> {
    path.with_path(|p| std::fs::create_dir_all(p))
  }

  fn stat(&self, path: PathId) -> Option<FileStat> {
    path.with_path(|path| {
      path.symlink_metadata().ok().and_then(|meta| {
        let is_symlink = meta.is_symlink();
        let metadata = path.metadata().ok()?;
        Some(FileStat::from_metadata(&metadata, is_symlink))
      })
    })
  }

  fn lstat(&self, path: PathId) -> Option<FileStat> {
    path.with_path(|path| {
      path.symlink_metadata().ok().and_then(|meta| {
        let is_symlink = meta.is_symlink();
        Some(FileStat::from_metadata(&meta, is_symlink))
      })
    })
  }
}
