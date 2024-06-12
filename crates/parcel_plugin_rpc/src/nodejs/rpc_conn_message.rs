use std::sync::mpsc::Sender;

#[derive(Debug)]
pub enum RpcConnectionMessage {
  Ping {
    response: Sender<Result<(), String>>,
  },
}

impl RpcConnectionMessage {
  pub fn get_id(&self) -> u32 {
    match self {
      Self::Ping { response: _ } => 0,
    }
  }
}
