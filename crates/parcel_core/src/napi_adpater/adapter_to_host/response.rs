use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum AdapterResponse {
  Ping(PingResponse),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PingResponse {}
