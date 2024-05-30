use std::fs::File;
use std::sync::Arc;

use parcel_config::PluginNode;
use parcel_core::plugin::CompressedFile;
use parcel_core::plugin::CompressorPlugin;
use parcel_core::plugin::PluginContext;

use super::Adapter;

#[derive(Debug)]
pub struct CompressorAdapter {
  name: String,
}

impl CompressorAdapter {
  pub fn new(adapter: Arc<dyn Adapter>, ctx: &PluginContext, plugin: &PluginNode) -> Self {
    CompressorAdapter {
      name: plugin.package_name.clone(),
    }
  }
}

impl CompressorPlugin for CompressorAdapter {
  fn compress(&self, _file: &File) -> Result<Option<CompressedFile>, String> {
    todo!()
  }
}
