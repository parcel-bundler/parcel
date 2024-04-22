use std::path::{Path, PathBuf};
use std::rc::Rc;

use dashmap::DashMap;
use napi::bindgen_prelude::FromNapiValue;
use napi::{Env, JsObject};

use parcel_resolver::FileSystem;

use crate::core::requests::call_method;

/// An implementation of `FileSystem` that delegates calls to a `JsObject`.
///
/// This is going to be very slow at runtime due to the overhead of converting
/// between rust and JS types.
pub struct JSDelegateFileSystem {
  env: Rc<Env>,
  js_delegate: JsObject,
}

impl JSDelegateFileSystem {
  pub fn new(env: Rc<Env>, js_delegate: JsObject) -> Self {
    Self { env, js_delegate }
  }
}

// Convert arbitrary errors to io errors. This is wrong; the `FileSystem` trait should use
// `anyhow::Result`
fn run_with_errors<T>(block: impl FnOnce() -> anyhow::Result<T>) -> Result<T, std::io::Error> {
  let result = block();
  result.map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err.to_string()))
}

impl FileSystem for JSDelegateFileSystem {
  fn canonicalize<P: AsRef<Path>>(
    &self,
    path: P,
    _cache: &DashMap<PathBuf, Option<PathBuf>>,
  ) -> std::io::Result<PathBuf> {
    run_with_errors(|| {
      let path = path.as_ref().to_str().unwrap();
      let js_path = self.env.create_string(path)?;
      let result = call_method(
        &self.env,
        &self.js_delegate,
        "canonicalize",
        &[&js_path.into_unknown()],
      )?;
      let result_string = result.coerce_to_string()?;
      let result_string = result_string.into_utf8()?.as_str()?.to_string();
      Ok(PathBuf::from(result_string))
    })
  }

  fn read_to_string<P: AsRef<Path>>(&self, path: P) -> std::io::Result<String> {
    run_with_errors(|| {
      let path = path.as_ref().to_str().unwrap();
      let js_path = self.env.create_string(path)?;
      let result = call_method(
        &self.env,
        &self.js_delegate,
        "readFileSync",
        &[&js_path.into_unknown()],
      )?;
      // Using buffer hopefully avoids a copy
      let buffer = napi::JsBuffer::from_unknown(result)?;
      let buffer = buffer.into_value()?;
      let buffer: &[u8] = buffer.as_ref();
      let result = String::from_utf8(buffer.to_vec())?;
      Ok(result)
    })
  }

  fn is_file<P: AsRef<Path>>(&self, path: P) -> bool {
    run_with_errors(|| {
      let path = path.as_ref().to_str().unwrap();
      let js_path = self.env.create_string(path)?;
      let result = call_method(
        &self.env,
        &self.js_delegate,
        "isFile",
        &[&js_path.into_unknown()],
      )?;
      let result_bool = result.coerce_to_bool()?.get_value()?;
      Ok(result_bool)
      // TODO error handling is messed up here; this should return `Result<bool>
    })
    .unwrap_or(false)
  }

  fn is_dir<P: AsRef<Path>>(&self, path: P) -> bool {
    run_with_errors(|| {
      let path = path.as_ref().to_str().unwrap();
      let js_path = self.env.create_string(path)?;
      let result = call_method(
        &self.env,
        &self.js_delegate,
        "isDir",
        &[&js_path.into_unknown()],
      )?;
      let result_bool = result.coerce_to_bool()?.get_value()?;
      Ok(result_bool)
      // TODO error handling is messed up here; this should return `Result<bool>
    })
    .unwrap_or(false)
  }
}
