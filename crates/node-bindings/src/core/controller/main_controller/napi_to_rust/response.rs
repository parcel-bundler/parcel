use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum CtrlResponse {
  Ping(PingResponse),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PingResponse {}
