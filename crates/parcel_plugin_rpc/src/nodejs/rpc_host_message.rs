use std::path::PathBuf;
use std::sync::mpsc::Sender;

pub enum RpcHostMessage {
  Ping {
    response: Sender<Result<(), String>>,
  },
  FsReadToString {
    path: PathBuf,
    response: Sender<Result<String, String>>,
  },
  FsIsFile {
    path: PathBuf,
    response: Sender<Result<bool, String>>,
  },
  FsIsDir {
    path: PathBuf,
    response: Sender<Result<bool, String>>,
  },
}

impl RpcHostMessage {
  pub fn get_id(&self) -> u32 {
    match self {
      Self::Ping { response: _ } => 0,
      Self::FsReadToString {
        path: _,
        response: _,
      } => 1,
      Self::FsIsFile {
        path: _,
        response: _,
      } => 2,
      Self::FsIsDir {
        path: _,
        response: _,
      } => 3,
    }
  }
}
