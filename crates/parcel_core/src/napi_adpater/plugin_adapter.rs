use std::fmt::Debug;
use std::sync::mpsc::Receiver;

use super::adapter_to_host;

pub trait PluginAdapter: Debug + Send + Sync {
  fn is_running(&self) -> bool;

  fn init(&self) -> Result<(), String>;

  fn send_all(
    &self,
    req: adapter_to_host::AdapterMessage,
  ) -> Result<Vec<adapter_to_host::AdapterResponse>, String>;

  fn send(
    &self,
    req: adapter_to_host::AdapterMessage,
  ) -> Receiver<adapter_to_host::AdapterResponse>;

  fn send_and_wait(
    &self,
    req: adapter_to_host::AdapterMessage,
  ) -> Result<adapter_to_host::AdapterMessageResponse, String>;
}
