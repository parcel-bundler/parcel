use std::path::PathBuf;
use std::sync::Arc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_core::types::FileSystem;
use parcel_core::Parcel;
use parcel_core::ParcelOptions;
use parking_lot::RwLock;

use crate::file_system::FileSystemNapi;

pub struct ParcelNapiOptions {
  fs: Option<Box<dyn FileSystem>>,
}

pub struct BuildOptionsNapi {}

pub struct BuildResultNapi {
  pub asset_graph: (),
}

#[napi]
pub struct ParcelNapi {
  internal: Arc<RwLock<Parcel>>,
  // Temporary, for testing
  fs_napi: Option<Arc<dyn FileSystem>>,
}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: JsObject) -> napi::Result<Self> {
    let fs_napi: Option<Arc<dyn FileSystem>> = 'block: {
      if !options.has_named_property("fs")? {
        break 'block None;
      }
      let fs_raw: JsObject = options.get_named_property("fs")?;
      Some(Arc::new(FileSystemNapi::new(&env, fs_raw)?))
    };

    let parcel = Parcel::new(ParcelOptions {
      fs: fs_napi.clone(),
    });

    Ok(Self {
      fs_napi,
      internal: Arc::new(RwLock::new(parcel)),
    })
  }

  // Temporary, for testing
  #[napi]
  pub async fn _testing_temp_fs_read_to_string(&self, path: String) -> napi::Result<String> {
    Ok(
      self
        .fs_napi
        .as_ref()
        .unwrap()
        .read_to_string(&PathBuf::from(path))?,
    )
  }

  #[napi]
  pub async fn _testing_temp_fs_is_file(&self, path: String) -> napi::Result<bool> {
    Ok(self.fs_napi.as_ref().unwrap().is_file(&PathBuf::from(path)))
  }

  #[napi]
  pub async fn _testing_temp_fs_is_dir(&self, path: String) -> napi::Result<bool> {
    Ok(self.fs_napi.as_ref().unwrap().is_dir(&PathBuf::from(path)))
  }
}
