use std::fs::File;

use parcel_config::PluginNode;
use parcel_core::plugin::CompressedFile;
use parcel_core::plugin::CompressorPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct PluginCompressorRpc {
  name: String,
}

impl PluginCompressorRpc {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Self {
    PluginCompressorRpc {
      name: plugin.package_name.clone(),
    }
  }
}

impl CompressorPlugin for PluginCompressorRpc {
  fn compress(&self, _file: &File) -> Result<Option<CompressedFile>, String> {
    todo!()
  }
}
