use std::io;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel::Parcel;
use parcel::ParcelOptions;
use parcel_plugin_rpc::nodejs::RpcHostNodejs;

use crate::file_system::FileSystemNapi;

enum ParcelMessage {
  RpcPing {
    response: Sender<()>,
  },
  FsReadToString {
    path: PathBuf,
    response: Sender<io::Result<String>>,
  },
  FsIsFile {
    path: PathBuf,
    response: Sender<bool>,
  },
  FsIsDir {
    path: PathBuf,
    response: Sender<bool>,
  },
}

enum ParcelResponse {}

#[napi]
pub struct ParcelNapi {
  tx_parcel: Sender<ParcelMessage>,
}

#[napi]
impl ParcelNapi {
  #[napi(constructor)]
  pub fn new(env: Env, options: JsObject) -> napi::Result<Self> {
    // Debugging Instrumentation
    let _ = tracing_subscriber::fmt::try_init();
    let thread_id = std::thread::current().id();
    tracing::trace!(?thread_id, "parcel-napi initialize");

    // Wrap the JavaScript-supplied FileSystem
    let fs = FileSystemNapi::from_options(&env, &options)?;

    // Set up Nodejs plugin bindings
    let rpc_host_nodejs = RpcHostNodejs::new(&env, options.get_named_property("rpc")?)?;

    // Initialize Parcel
    let parcel = Parcel::new(ParcelOptions {
      fs,
      rpc: Some(Arc::new(rpc_host_nodejs)),
    });

    // Run Parcel within its own thread
    let (tx_parcel, rx_parcel) = channel::<ParcelMessage>();
    thread::spawn(move || {
      while let Ok(msg) = rx_parcel.recv() {
        if match msg {
          ParcelMessage::FsReadToString { path, response } => {
            response.send(parcel.fs.read_to_string(&path)).is_err()
          }
          ParcelMessage::FsIsFile { path, response } => {
            response.send(parcel.fs.is_file(&path)).is_err()
          }
          ParcelMessage::FsIsDir { path, response } => {
            response.send(parcel.fs.is_dir(&path)).is_err()
          }
          ParcelMessage::RpcPing { response } => response
            .send(parcel.rpc.as_ref().unwrap().ping().unwrap())
            .is_err(),
        } {
          return;
        }
      }
    });

    Ok(Self { tx_parcel })
  }

  // Temporary, for testing
  #[napi]
  pub async fn _testing_temp_fs_read_to_string(&self, path: String) -> napi::Result<String> {
    let (tx, rx) = channel();
    self
      .tx_parcel
      .send(ParcelMessage::FsReadToString {
        path: PathBuf::from(path),
        response: tx,
      })
      .unwrap();
    Ok(rx.recv().unwrap()?)
  }

  #[napi]
  pub async fn _testing_temp_fs_is_file(&self, path: String) -> napi::Result<bool> {
    let (tx, rx) = channel();
    self
      .tx_parcel
      .send(ParcelMessage::FsIsFile {
        path: PathBuf::from(path),
        response: tx,
      })
      .unwrap();
    Ok(rx.recv().unwrap())
  }

  #[napi]
  pub async fn _testing_temp_fs_is_dir(&self, path: String) -> napi::Result<bool> {
    let (tx, rx) = channel();
    self
      .tx_parcel
      .send(ParcelMessage::FsIsDir {
        path: PathBuf::from(path),
        response: tx,
      })
      .unwrap();
    Ok(rx.recv().unwrap())
  }

  #[napi]
  pub async fn _testing_rpc_ping(&self) -> napi::Result<()> {
    let (tx, rx) = channel();
    self
      .tx_parcel
      .send(ParcelMessage::RpcPing { response: tx })
      .unwrap();
    Ok(rx.recv().unwrap())
  }
}
