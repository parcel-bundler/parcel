use std::sync::Arc;

use crate::RpcHostMessage;
use crate::RpcHostResponse;

pub type RpcHostRef = Arc<dyn RpcHost>;

pub trait RpcHost: Send + Sync {
  fn send(&self, message: RpcHostMessage) -> RpcHostResponse;
}
