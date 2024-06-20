use std::path::Path;

use napi::JsObject;
use parcel::file_system::FileSystem;

use crate::helpers::js_callable::JsCallable;

// TODO error handling

pub struct FileSystemNapi {
  read_file_fn: JsCallable,
  is_file_fn: JsCallable,
  is_dir_fn: JsCallable,
}

impl FileSystemNapi {
  pub fn new(js_file_system: &JsObject) -> napi::Result<Self> {
    Ok(Self {
      read_file_fn: JsCallable::new_from_object_prop("readFileSync", &js_file_system)?,
      is_file_fn: JsCallable::new_from_object_prop("isFile", &js_file_system)?,
      is_dir_fn: JsCallable::new_from_object_prop("isDir", &js_file_system)?,
    })
  }
}

impl FileSystem for FileSystemNapi {
  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    self
      .read_file_fn
      .call_with_return((path.to_path_buf(), "utf8"))
      .map_err(|e| std::io::Error::other(e))
  }

  fn is_file(&self, path: &Path) -> bool {
    self
      .is_file_fn
      .call_with_return(path.to_path_buf())
      .expect("TODO handle error case")
  }

  fn is_dir(&self, path: &Path) -> bool {
    self
      .is_dir_fn
      .call_with_return(path.to_path_buf())
      .expect("TODO handle error case")
  }
}
