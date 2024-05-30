use std::path::Path;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::thread;

use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsString;
use napi::JsUnknown;
use napi_derive::napi;
use parcel_core::Parcel;
use parcel_core::ParcelOptions;
use parcel_filesystem::js_delegate_file_system::JSDelegateFileSystem;
use parcel_filesystem::FileSystem;
use serde::Deserialize;
use serde::Serialize;

use crate::file_system::file_system_napi::FileSystemNapi;

pub struct ParcelNapiOptions {
  fs: Option<Box<dyn FileSystem>>,
}

pub struct BuildOptionsNapi {}

pub struct BuildResultNapi {
  pub asset_graph: (),
}

#[napi]
pub struct ParcelNapi {
  fs_napi: FileSystemNapi,
}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: JsObject) -> napi::Result<Self> {
    if !options.has_named_property("fs")? {}
    let fs_raw: JsObject = options.get_named_property("fs")?;
    let fs_napi = FileSystemNapi::new(&env, fs_raw)?;

    Ok(Self { fs_napi })
  }

  #[napi]
  pub fn _testing_temp_fs_read_to_string(&self, path: String) -> napi::Result<String> {
    Ok(self.fs_napi.read_to_string(&PathBuf::from(path))?)
  }

  #[napi]
  pub fn _testing_temp_fs_is_file(&self, path: String) -> napi::Result<bool> {
    Ok(self.fs_napi.is_file(&PathBuf::from(path)))
  }

  #[napi]
  pub fn _testing_temp_fs_is_dir(&self, path: String) -> napi::Result<bool> {
    Ok(self.fs_napi.is_dir(&PathBuf::from(path)))
  }
}
