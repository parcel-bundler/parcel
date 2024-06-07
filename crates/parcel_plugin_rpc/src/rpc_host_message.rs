use std::sync::mpsc::Sender;

pub enum RpcHostMessage {
  Ping {
    response: Sender<Result<(), String>>,
  },
}
