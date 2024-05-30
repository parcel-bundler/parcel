use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::thread;

use crossbeam_channel::Receiver;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUnknown;
use parcel_filesystem::FileSystem;

pub struct FileSystemNapi {
  tx_read_to_string: Sender<(PathBuf, Sender<String>)>,
  tx_read_to_string: Sender<(PathBuf, Sender<String>)>,
}

/*
{
    canonicalize: path => this.options.fs.realpathSync(path),
    read: path => this.options.fs.readFileSync(path),
    isFile: path => this.options.fs.statSync(path).isFile(),
    isDir: path => this.options.fs.statSync(path).isDirectory(),
}
*/

impl FileSystemNapi {
  pub fn new(env: &Env, js_file_system: JsObject) -> napi::Result<Self> {
    Ok(Self { tx_read_to_string })
  }

  fn call_js_fs<T>(&self, method: &str, args: T) {}
}

impl FileSystem for FileSystemNapi {
  //   fn canonicalize(&self, path: &Path, _cache: &DashMap<PathBuf, Option<PathBuf>>) {}

  fn read_to_string(&self, path: &Path) -> std::io::Result<String> {
    let (tx, rx) = channel();

    self
      .tx_read_to_string
      .send((path.to_path_buf(), tx))
      .unwrap();

    Ok(rx.recv().unwrap())
  }

  fn is_file(&self, path: &Path) -> bool {
    self.call_js_fs("isFile", (path.to_path_buf()));

    todo!();
  }

  fn is_dir(&self, path: &Path) -> bool {
    todo!()
  }
}

fn create_js_callback<T, U>(env: &Env) -> Sender<(T, Sender<U>)> {
  let (tx, rx) = channel::<(T, Sender<U>)>();

  let jsfn_read_to_string: JsFunction =
    js_file_system.get_property(env.create_string("readFileSync")?)?;

  let tsfn_read_to_string = env.create_threadsafe_function(
    &jsfn_read_to_string,
    0,
    |ctx: napi::threadsafe_function::ThreadSafeCallContext<PathBuf>| {
      let path = ctx.env.to_js_value(&ctx.value)?;
      let encoding = ctx.env.create_string("utf8")?.into_unknown();
      Ok(vec![path, encoding])
    },
  )?;

  let unsafe_env = env.raw() as usize;

  thread::spawn(move || {
    while let Ok((path, rx_result)) = rx.recv() {
      tsfn_read_to_string.call_with_return_value(
        Ok(path),
        ThreadsafeFunctionCallMode::Blocking,
        move |result: JsUnknown| {
          let env = unsafe { Env::from_raw(unsafe_env as _) };

          let result = env.from_js_value::<String, JsUnknown>(result)?;
          rx_result.send(result).unwrap();

          return Ok(());
        },
      );
    }
  });

  tx
}
