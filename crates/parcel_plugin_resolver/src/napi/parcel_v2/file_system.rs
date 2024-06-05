use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;

use dashmap::DashMap;
use napi::bindgen_prelude::Either3;
use napi::JsBoolean;
use napi::JsBuffer;
use napi::JsFunction;
use napi::JsString;
use napi_derive::napi;
use parcel_resolver::FileSystem;

use super::function_ref::FunctionRef;

pub type NapiSideEffectsVariants = Either3<bool, Vec<String>, HashMap<String, bool>>;

#[napi(object)]
pub struct JsFileSystemOptions {
  pub canonicalize: JsFunction,
  pub read: JsFunction,
  pub is_file: JsFunction,
  pub is_dir: JsFunction,
  pub include_node_modules: Option<NapiSideEffectsVariants>,
}

pub struct JsFileSystem {
  pub canonicalize: FunctionRef,
  pub read: FunctionRef,
  pub is_file: FunctionRef,
  pub is_dir: FunctionRef,
}

impl FileSystem for JsFileSystem {
  fn canonicalize(
    &self,
    path: &Path,
    _cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<std::path::PathBuf> {
    let canonicalize = || -> napi::Result<_> {
      let path = path.to_string_lossy();
      let path = self.canonicalize.env.create_string(path.as_ref())?;
      let res: JsString = self.canonicalize.get()?.call(None, &[path])?.try_into()?;
      let utf8 = res.into_utf8()?;
      Ok(utf8.into_owned()?.into())
    };

    canonicalize().map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    let read = || -> napi::Result<_> {
      let path = path.to_string_lossy();
      let path = self.read.env.create_string(path.as_ref())?;
      let res: JsBuffer = self.read.get()?.call(None, &[path])?.try_into()?;
      let value = res.into_value()?;
      Ok(unsafe { String::from_utf8_unchecked(value.to_vec()) })
    };

    read().map_err(|err| std::io::Error::new(std::io::ErrorKind::NotFound, err.to_string()))
  }

  fn is_file(&self, path: &Path) -> bool {
    let is_file = || -> napi::Result<_> {
      let path = path.to_string_lossy();
      let p = self.is_file.env.create_string(path.as_ref())?;
      let res: JsBoolean = self.is_file.get()?.call(None, &[p])?.try_into()?;
      res.get_value()
    };

    is_file().unwrap_or(false)
  }

  fn is_dir(&self, path: &Path) -> bool {
    let is_dir = || -> napi::Result<_> {
      let path = path.to_string_lossy();
      let path = self.is_dir.env.create_string(path.as_ref())?;
      let res: JsBoolean = self.is_dir.get()?.call(None, &[path])?.try_into()?;
      res.get_value()
    };

    is_dir().unwrap_or(false)
  }
}

#[cfg(not(feature = "wasm"))]
pub enum EitherFs<A, B> {
  A(A),
  B(B),
}

#[cfg(not(feature = "wasm"))]
impl<A: FileSystem, B: FileSystem> FileSystem for EitherFs<A, B> {
  fn canonicalize(
    &self,
    path: &Path,
    cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<std::path::PathBuf> {
    match self {
      EitherFs::A(a) => a.canonicalize(path, cache),
      EitherFs::B(b) => b.canonicalize(path, cache),
    }
  }

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    match self {
      EitherFs::A(a) => a.read_to_string(path),
      EitherFs::B(b) => b.read_to_string(path),
    }
  }

  fn is_file(&self, path: &Path) -> bool {
    match self {
      EitherFs::A(a) => a.is_file(path),
      EitherFs::B(b) => b.is_file(path),
    }
  }

  fn is_dir(&self, path: &Path) -> bool {
    match self {
      EitherFs::A(a) => a.is_dir(path),
      EitherFs::B(b) => b.is_dir(path),
    }
  }
}
