use std::{
  io,
  path::{Path, PathBuf},
};

use napi::{Env, JsObject};
use atlaspack::file_system::FileSystem;

use atlaspack_napi_helpers::js_callable::JsCallable;

// TODO error handling

pub struct FileSystemNapi {
  canonicalize_fn: JsCallable,
  create_directory_fn: JsCallable,
  cwd_fn: JsCallable,
  read_file_fn: JsCallable,
  is_file_fn: JsCallable,
  is_dir_fn: JsCallable,
}

impl FileSystemNapi {
  pub fn new(env: &Env, js_file_system: &JsObject) -> napi::Result<Self> {
    Ok(Self {
      canonicalize_fn: JsCallable::new_from_object_prop("canonicalize", &js_file_system)?
        .into_unref(env)?,
      create_directory_fn: JsCallable::new_from_object_prop("createDirectory", &js_file_system)?
        .into_unref(env)?,
      cwd_fn: JsCallable::new_from_object_prop("cwd", &js_file_system)?.into_unref(env)?,
      read_file_fn: JsCallable::new_from_object_prop("readFile", &js_file_system)?
        .into_unref(env)?,
      is_file_fn: JsCallable::new_from_object_prop("isFile", &js_file_system)?.into_unref(env)?,
      is_dir_fn: JsCallable::new_from_object_prop("isDir", &js_file_system)?.into_unref(env)?,
    })
  }
}

impl FileSystem for FileSystemNapi {
  fn canonicalize_base(&self, path: &Path) -> io::Result<PathBuf> {
    self
      .canonicalize_fn
      .call_with_return_serde(path.to_path_buf())
      .map_err(|e| io::Error::other(e))
  }

  fn create_directory(&self, path: &Path) -> std::io::Result<()> {
    self
      .create_directory_fn
      .call_with_return_serde(path.to_path_buf())
      .map_err(|e| io::Error::other(e))
  }

  fn cwd(&self) -> io::Result<PathBuf> {
    self
      .cwd_fn
      .call_with_return_serde(None::<bool>)
      .map_err(|e| io::Error::other(e))
  }

  fn read_to_string(&self, path: &Path) -> io::Result<String> {
    self
      .read_file_fn
      .call_with_return_serde((path.to_path_buf(), "utf8"))
      .map_err(|e| io::Error::other(e))
  }

  fn is_file(&self, path: &Path) -> bool {
    self
      .is_file_fn
      .call_with_return_serde(path.to_path_buf())
      .expect("TODO handle error case")
  }

  fn is_dir(&self, path: &Path) -> bool {
    self
      .is_dir_fn
      .call_with_return_serde(path.to_path_buf())
      .expect("TODO handle error case")
  }
}
