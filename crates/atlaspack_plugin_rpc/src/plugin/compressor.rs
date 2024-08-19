use std::fmt;
use std::fmt::Debug;
use std::fs::File;

use atlaspack_config::PluginNode;
use atlaspack_core::plugin::CompressedFile;
use atlaspack_core::plugin::CompressorPlugin;
use atlaspack_core::plugin::PluginContext;

pub struct RpcCompressorPlugin {
  _name: String,
}

impl Debug for RpcCompressorPlugin {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "RpcCompressorPlugin")
  }
}

impl RpcCompressorPlugin {
  pub fn new(_ctx: &PluginContext, plugin: &PluginNode) -> Self {
    RpcCompressorPlugin {
      _name: plugin.package_name.clone(),
    }
  }
}

impl CompressorPlugin for RpcCompressorPlugin {
  fn compress(&self, _file: &File) -> Result<Option<CompressedFile>, String> {
    todo!()
  }
}
