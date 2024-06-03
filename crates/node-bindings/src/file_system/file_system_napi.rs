use std::path::Path;
use std::path::PathBuf;

use napi::bindgen_prelude::FromNapiValue;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use parcel_filesystem::FileSystem;
use serde::de::DeserializeOwned;
use serde::Serialize;

// TODO error handling

pub struct FileSystemNapi {
  read_file_fn: Box<dyn Fn((PathBuf, String)) -> String + Send + Sync>,
  is_file_fn: Box<dyn Fn(PathBuf) -> bool + Send + Sync>,
  is_dir_fn: Box<dyn Fn(PathBuf) -> bool + Send + Sync>,
}

impl FileSystemNapi {
  pub fn new(env: &Env, js_file_system: JsObject) -> napi::Result<Self> {
    Ok(Self {
      read_file_fn: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "readFileSync",
      )?),
      is_file_fn: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "isFile",
      )?),
      is_dir_fn: Box::new(create_js_thread_safe_method(
        &env,
        &js_file_system,
        "isDir",
      )?),
    })
  }
}

// These methods must be run off the nodejs main/worker
// thread or they will cause JavaScript to deadlock
impl FileSystem for FileSystemNapi {
  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    Ok((*self.read_file_fn)((
      path.to_path_buf(),
      "utf8".to_string(),
    )))
  }

  fn is_file(&self, path: &Path) -> bool {
    (*self.is_file_fn)(path.to_path_buf())
  }

  fn is_dir(&self, path: &Path) -> bool {
    (*self.is_dir_fn)(path.to_path_buf())
  }
}

fn create_js_thread_safe_method<
  Params: Send + Serialize + 'static,
  Response: Send + DeserializeOwned + 'static + FromNapiValue,
>(
  env: &Env,
  js_file_system: &JsObject,
  method_name: &str,
) -> Result<impl Fn(Params) -> Response, napi::Error> {
  let jsfn: JsFunction = js_file_system.get_property(env.create_string(method_name)?)?;

  let threadsafe_function = env.create_threadsafe_function(
    &jsfn,
    0,
    |ctx: napi::threadsafe_function::ThreadSafeCallContext<Params>| {
      Ok(vec![ctx.env.to_js_value(&ctx.value)?])
    },
  )?;
  let result = move |params| {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    threadsafe_function.call_with_return_value(
      Ok(params),
      ThreadsafeFunctionCallMode::Blocking,
      move |result: Response| {
        let _ = tx.send(result);
        Ok(())
      },
    );
    rx.recv().unwrap()
  };

  Ok(result)
}
