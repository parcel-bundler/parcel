use std::{
  any::Any,
  borrow::Cow,
  hash::{Hash, Hasher},
  sync::Arc,
};

use crate::{Bundle, BundleGraph, Diagnostic, DiagnosticList, FileSystem, ParcelOptions, PathId};

#[derive(Hash, PartialEq, Eq, Clone, Debug)]
pub struct ContentType(u128);

impl ContentType {
  pub const fn new(name: &str) -> Self {
    let digest = sha2_const_stable::Sha256::new()
      .update(name.as_bytes())
      .finalize();
    ContentType::from_bytes([
      digest[0], digest[1], digest[3], digest[4], digest[5], digest[6], digest[7], digest[8],
      digest[9], digest[10], digest[11], digest[12], digest[13], digest[14], digest[15],
      digest[16],
    ])
  }

  pub const fn from_bytes(bytes: [u8; 16]) -> Self {
    let id = u128::from_le_bytes(bytes);
    ContentType(id)
  }
}

/// Builds a stable content type id by prefixing the plugin crate's package name.
#[macro_export]
macro_rules! content_type {
  ($name:literal) => {
    const {
      $crate::ContentType::new(concat!(
        "parcel-core.content.v1\0",
        env!("CARGO_PKG_NAME"),
        "\0",
        $name
      ))
    }
  };
}

// Deliberately NOT `std::fmt::Debug`: a Debug supertrait puts every content
// type's full Debug impl in the `dyn Content` vtable, which retains the Debug
// code for the entire embedded AST (the swc AST for JsContent, the
// lightningcss StyleSheet for CssContent — several hundred KiB of formatting
// code the linker otherwise strips).
pub trait Content: Any + Send + Sync {
  /// Reads the content as a byte vector.
  fn read(&self) -> Result<Vec<u8>, Diagnostic>;

  fn read_string(&self) -> Result<Cow<'_, str>, Diagnostic> {
    Ok(Cow::Owned(String::from_utf8(self.read()?)?))
  }

  /// Writes the content to a file.
  fn write(&self, fs: &dyn FileSystem, path: PathId) -> Result<(), Diagnostic> {
    Ok(fs.write(path, &self.read()?)?)
  }

  fn hash(&self, mut state: &mut dyn Hasher) {
    let content = self.read();
    content.hash(&mut state);
  }

  fn eq(&self, other: &dyn Content) -> bool {
    let a = self.read();
    let b = other.read();
    a == b
  }

  /// Stable id for this content type.
  fn ty(&self) -> ContentType;

  #[allow(unused_variables)]
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    if bundle.assets.len() != 1 {
      return Err(
        Diagnostic {
          message: "Raw bundles must only contain one asset".into(),
          code_frames: vec![],
          origin: Some("@parcel/package-raw".into()),
          documentation_url: None,
          hints: vec![],
          severity: crate::DiagnosticSeverity::Error,
        }
        .into(),
      );
    }

    Ok(
      bundle_graph
        .asset_graph
        .asset(bundle.assets[0])
        .content
        .clone(),
    )
  }
}

impl std::fmt::Debug for dyn Content {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("<content>")
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
  path: PathId,
  fs: Arc<dyn FileSystem>,
}

impl FileContent {
  pub fn new(path: PathId, fs: Arc<dyn FileSystem>) -> Self {
    FileContent { path, fs }
  }
}

impl Content for FileContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.fs.read(self.path)?)
  }

  fn write(&self, fs: &dyn FileSystem, path: PathId) -> Result<(), Diagnostic> {
    // Use native FS copy so we get copy on write behavior.
    if Arc::as_ptr(&self.fs) == fs {
      Ok(fs.copy(self.path, path)?)
    } else {
      Ok(fs.write(path, &self.read()?)?)
    }
  }

  fn eq(&self, other: &dyn Content) -> bool {
    if let Some(other) = other.downcast_ref::<FileContent>() {
      Arc::ptr_eq(&self.fs, &other.fs) && self.path == other.path
    } else {
      false
    }
  }

  fn hash(&self, mut state: &mut dyn Hasher) {
    self.path.hash(&mut state);
  }

  fn ty(&self) -> ContentType {
    content_type!("FileContent")
  }
}

impl std::fmt::Debug for FileContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "FileContent {{ path: {:?} }}", self.path)
  }
}

#[derive(Debug)]
enum Buffer {
  Bytes(Vec<u8>),
  String(String),
}

impl Buffer {
  fn to_vec(&self) -> Vec<u8> {
    match self {
      Buffer::Bytes(v) => v.clone(),
      Buffer::String(v) => v.clone().into_bytes(),
    }
  }

  fn as_bytes(&self) -> &[u8] {
    match self {
      Buffer::Bytes(v) => v.as_slice(),
      Buffer::String(v) => v.as_bytes(),
    }
  }

  fn as_str(&self) -> Result<Cow<'_, str>, Diagnostic> {
    match self {
      Buffer::Bytes(v) => Ok(Cow::Borrowed(std::str::from_utf8(v)?)),
      Buffer::String(v) => Ok(Cow::Borrowed(v.as_str())),
    }
  }
}

#[derive(Debug)]
pub struct BufferContent {
  buf: Buffer,
}

impl BufferContent {
  pub fn new(buf: Vec<u8>) -> Self {
    BufferContent {
      buf: Buffer::Bytes(buf),
    }
  }

  pub fn new_string(string: String) -> Self {
    BufferContent {
      buf: Buffer::String(string),
    }
  }
}

impl Content for BufferContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.buf.to_vec())
  }

  fn read_string(&self) -> Result<Cow<'_, str>, Diagnostic> {
    self.buf.as_str()
  }

  fn write(&self, fs: &dyn FileSystem, path: PathId) -> Result<(), Diagnostic> {
    Ok(fs.write(path, self.buf.as_bytes())?)
  }

  fn ty(&self) -> ContentType {
    content_type!("BufferContent")
  }
}

#[derive(Debug)]
pub struct ContentWithSourceMap {
  code: Buffer,
  map: Vec<u8>,
}

impl ContentWithSourceMap {
  pub fn new(code: Vec<u8>, map: Vec<u8>) -> Self {
    ContentWithSourceMap {
      code: Buffer::Bytes(code),
      map,
    }
  }

  pub fn new_string(code: String, map: Vec<u8>) -> Self {
    ContentWithSourceMap {
      code: Buffer::String(code),
      map,
    }
  }

  pub fn source_map(&self) -> &[u8] {
    &self.map
  }
}

impl Content for ContentWithSourceMap {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    Ok(self.code.to_vec())
  }

  fn read_string(&self) -> Result<Cow<'_, str>, Diagnostic> {
    self.code.as_str()
  }

  fn write(&self, fs: &dyn FileSystem, path: PathId) -> Result<(), Diagnostic> {
    fs.write(path, self.code.as_bytes())?;
    fs.write(path.add_extension("map"), &self.map)?;
    Ok(())
  }

  fn ty(&self) -> ContentType {
    content_type!("ContentWithSourceMap")
  }
}
