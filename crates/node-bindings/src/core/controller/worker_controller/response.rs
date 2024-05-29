use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum WorkerControllerMessageResponse {
  Ping(ControllerMessagePingResponse),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ControllerMessagePingResponse {}
