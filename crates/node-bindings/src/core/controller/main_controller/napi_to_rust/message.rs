use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum CtrlMessage {
  Ping(PingMessage),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PingMessage {}
