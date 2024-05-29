use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
pub enum WorkerControllerMessageRequest {
  Ping(ControllerMessagePingRequest),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ControllerMessagePingRequest {}
