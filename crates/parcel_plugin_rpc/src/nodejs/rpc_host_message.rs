use std::sync::mpsc::Sender;

pub enum RpcHostMessage {
  Ping {
    response: Sender<Result<(), String>>,
  },
  CacheSetBlob {
    key: String,
    blob: String,
    response: Sender<Result<(), String>>,
  },
}

// These n
impl RpcHostMessage {
  pub fn get_id(&self) -> u32 {
    match self {
      Self::Ping { response: _ } => 0,
      Self::CacheSetBlob {
        key: _,
        blob: _,
        response: _,
      } => 1,
    }
  }
}
