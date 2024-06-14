use std::sync::mpsc::Sender;

pub enum RpcHostMessage {
  Ping {
    response: Sender<Result<(), String>>,
  },
}

impl RpcHostMessage {
  pub fn get_id(&self) -> u32 {
    match self {
      Self::Ping { response: _ } => 0,
    }
  }
}
