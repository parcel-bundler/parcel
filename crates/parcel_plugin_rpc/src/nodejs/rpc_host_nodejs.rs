use crate::RpcHost;

pub struct RpcHostNodejs {}

impl RpcHostNodejs {
  pub fn new() -> Self {
    Self {}
  }
}

impl RpcHost for RpcHostNodejs {
  fn send(&self, _message: crate::RpcHostMessage) -> crate::RpcHostResponse {
    todo!()
  }
}
