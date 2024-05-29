use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum AdapterMessage {
  Ping(PingMessage),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PingMessage {}
