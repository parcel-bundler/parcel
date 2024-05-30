use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::thread;

use napi::Env;
use napi::JsFunction;
use napi::JsObject;
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
pub struct ParcelNapi {}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: JsObject) -> napi::Result<Self> {
    if !options.has_named_property("fs")? {}
    let fs_raw: JsObject = options.get_named_property("fs")?;
    let js_delegate_fs = FileSystemNapi::new(&env, fs_raw)?;

    thread::spawn(move || {
      let p = js_delegate_fs
        .read_to_string(&PathBuf::from(
          "/home/dalsh/Development/parcel/parcel/crates/node-bindings/src/parcel/parcel.rs",
        ))
        .unwrap();

      println!("{}", p);
    });

    Ok(Self {})
  }

  //   #[napi]
  //   pub fn create_asset_graph() -> Result<BuildResultNapi, anyhow::Error> {
  //     todo!();
  //   }
}
