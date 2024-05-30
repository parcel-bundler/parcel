use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::thread;

use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUnknown;
use parcel_filesystem::FileSystem;
use serde::de::DeserializeOwned;
use serde::Serialize;

// TODO error handling

#[derive(Clone)]
pub struct FileSystemNapi {
  tx_read_file_sync: Sender<(PathBuf, Sender<String>)>,
  tx_is_file_sync: Sender<(PathBuf, Sender<bool>)>,
  tx_is_dir_sync: Sender<(PathBuf, Sender<bool>)>,
}

impl FileSystemNapi {
  pub fn new(env: &Env, js_file_system: JsObject) -> napi::Result<Self> {
    Ok(Self {
      tx_read_file_sync: create_js_callback(&env, &js_file_system, "readFileSync")?,
      tx_is_file_sync: create_js_callback(&env, &js_file_system, "isFile")?,
      tx_is_dir_sync: create_js_callback(&env, &js_file_system, "isDir")?,
    })
  }
}

// These methods must be run off the nodejs main/worker
// thread or they will cause JavaScript to deadlock
impl FileSystem for FileSystemNapi {
  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    let (tx, rx) = channel();

    self
      .tx_read_file_sync
      .send((path.to_path_buf(), tx))
      .unwrap();

    Ok(rx.recv().unwrap())
  }

  fn is_file(&self, path: &Path) -> bool {
    let (tx, rx) = channel();

    self.tx_is_file_sync.send((path.to_path_buf(), tx)).unwrap();

    rx.recv().unwrap()
  }

  fn is_dir(&self, path: &Path) -> bool {
    let (tx, rx) = channel();

    self.tx_is_dir_sync.send((path.to_path_buf(), tx)).unwrap();

    rx.recv().unwrap()
  }
}

fn create_js_callback<
  Params: Send + Serialize + 'static,
  Response: Send + DeserializeOwned + 'static,
>(
  env: &Env,
  js_file_system: &JsObject,
  method_name: &str,
) -> napi::Result<Sender<(Params, Sender<Response>)>> {
  let (tx, rx) = channel::<(Params, Sender<Response>)>();

  let jsfn: JsFunction = js_file_system.get_property(env.create_string(method_name)?)?;

  let tsfn = env.create_threadsafe_function(
    &jsfn,
    0,
    |ctx: napi::threadsafe_function::ThreadSafeCallContext<Params>| {
      Ok(vec![ctx.env.to_js_value(&ctx.value)?])
    },
  )?;

  let unsafe_env = env.raw() as usize;

  thread::spawn(move || {
    while let Ok((path, rx_result)) = rx.recv() {
      tsfn.call_with_return_value(
        Ok(path),
        ThreadsafeFunctionCallMode::Blocking,
        move |result: JsUnknown| {
          let env = unsafe { Env::from_raw(unsafe_env as _) };

          let result = env.from_js_value::<Response, JsUnknown>(result)?;
          rx_result.send(result).unwrap();

          return Ok(());
        },
      );
    }
  });

  Ok(tx)
}
