use std::path::PathBuf;
use std::sync::Arc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_core::FileSystemRef;
use parcel_core::Parcel;
use parcel_core::ParcelOptions;

use crate::file_system::FileSystemNapi;

#[napi]
pub struct ParcelNapi {
  internal: Arc<Parcel>,
}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: JsObject) -> napi::Result<Self> {
    let mut fs = None::<FileSystemRef>;

    if options.has_named_property("fs")? {
      let fs_raw: JsObject = options.get_named_property("fs")?;
      fs.replace(Arc::new(FileSystemNapi::new(&env, fs_raw)?));
    }

    let parcel = Parcel::new(ParcelOptions { fs });

    Ok(Self {
      internal: Arc::new(parcel),
    })
  }

  // Temporary, for testing
  #[napi]
  pub async fn _testing_temp_fs_read_to_string(&self, path: String) -> napi::Result<String> {
    Ok(self.internal.fs.read_to_string(&PathBuf::from(path))?)
  }

  #[napi]
  pub async fn _testing_temp_fs_is_file(&self, path: String) -> napi::Result<bool> {
    Ok(self.internal.fs.is_file(&PathBuf::from(path)))
  }

  #[napi]
  pub async fn _testing_temp_fs_is_dir(&self, path: String) -> napi::Result<bool> {
    Ok(self.internal.fs.is_dir(&PathBuf::from(path)))
  }
}
