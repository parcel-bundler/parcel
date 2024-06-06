use std::fs::File;

use parcel_config::PluginNode;
use parcel_core::plugin::CompressedFile;
use parcel_core::plugin::CompressorPlugin;
use parcel_core::plugin::PluginContext;

#[derive(Debug)]
pub struct NapiCompressorPlugin {
  name: String,
}

impl NapiCompressorPlugin {
  pub fn new(ctx: &PluginContext, plugin: &PluginNode) -> Self {
    NapiCompressorPlugin {
      name: plugin.package_name.clone(),
    }
  }
}

impl CompressorPlugin for NapiCompressorPlugin {
  fn compress(&self, _file: &File) -> Result<Option<CompressedFile>, String> {
    todo!()
  }
}
