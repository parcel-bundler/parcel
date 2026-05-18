use std::{
  any::Any,
  path::{Path, PathBuf},
  sync::Arc,
};

use crate::{Diagnostic, FileSystem};

pub trait Content: Any + std::fmt::Debug + Send + Sync {
  /// Reads the content as a byte vector.
  fn read(&self) -> Result<Vec<u8>, Diagnostic>;

  /// Writes the content to a file.
  fn write(&self, fs: &dyn FileSystem, path: &Path) -> Result<(), Diagnostic> {
    Ok(fs.write(path, &self.read()?)?)
  }
}

impl dyn Content {
  pub fn downcast_ref<T: 'static>(&self) -> Option<&T> {
    let v = self as &dyn Any;
    v.downcast_ref()
  }
}

impl serde::Serialize for dyn Content {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    serde_bytes::serialize(
      &self
        .read()
        .map_err(|e| serde::ser::Error::custom(e.to_string()))?,
      serializer,
    )
  }
}

pub struct FileContent {
  path: PathBuf,
  fs: Arc<dyn FileSystem>,
}

impl FileContent {
  pub fn new(path: PathBuf, fs: Arc<dyn FileSystem>) -> Self {
    FileContent { path, fs }
  }
}

impl Content for FileContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.fs.read(&self.path)?)
  }

  fn write(&self, fs: &dyn FileSystem, path: &Path) -> Result<(), Diagnostic> {
    // Use native FS copy so we get copy on write behavior.
    if Arc::as_ptr(&self.fs) == fs {
      Ok(fs.copy(&self.path, path)?)
    } else {
      Ok(fs.write(path, &self.read()?)?)
    }
  }
}

impl std::fmt::Debug for FileContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "FileContent {{ path: {:?} }}", self.path)
  }
}

#[derive(Debug)]
pub struct BufferContent {
  buf: Vec<u8>,
}

impl BufferContent {
  pub fn new(buf: Vec<u8>) -> Self {
    BufferContent { buf }
  }
}

impl Content for BufferContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.buf.clone())
  }

  fn write(&self, fs: &dyn FileSystem, path: &Path) -> Result<(), Diagnostic> {
    Ok(fs.write(path, &self.buf)?)
  }
}

#[derive(Debug)]
pub struct ContentWithSourceMap {
  code: Vec<u8>,
  map: Vec<u8>,
}

impl ContentWithSourceMap {
  pub fn new(code: Vec<u8>, map: Vec<u8>) -> Self {
    ContentWithSourceMap { code, map }
  }
}

impl Content for ContentWithSourceMap {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.clone())
  }

  fn write(&self, fs: &dyn FileSystem, path: &Path) -> Result<(), Diagnostic> {
    fs.write(path, &self.code)?;
    fs.write(&path.with_added_extension("map"), &self.map)?;
    Ok(())
  }
}
