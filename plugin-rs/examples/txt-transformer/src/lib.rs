use parcel_plugin::{Asset, Diagnostic, Plugin, register_plugin};

struct TxtTransformer;

impl Plugin for TxtTransformer {
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(TxtTransformer)
  }

  fn transform(&self, asset: &mut Asset, _options: &parcel_plugin::Options) -> Result<(), Diagnostic> {
    // Emit an ES module that default-exports the text content.
    asset.set_content(format!("export default {:?};\n", asset.content()));
    asset.set_type("js");
    Ok(())
  }
}

register_plugin!(TxtTransformer);
