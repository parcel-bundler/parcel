use parcel_plugin::{Asset, Diagnostic, Plugin, register_plugin};

/// Parcel constructs one of these per pipeline entry, passing that entry's
/// config, so the same library can appear in a .parcelrc more than once with
/// different settings.
struct TxtTransformer {
  prefix: String,
}

impl Plugin for TxtTransformer {
  fn new(config: &[u8]) -> Result<Self, Diagnostic> {
    let prefix = if config.is_empty() {
      String::new()
    } else {
      let config: serde_json::Value =
        serde_json::from_slice(config).map_err(|e| Diagnostic::new(e.to_string()))?;
      config
        .get("prefix")
        .and_then(|prefix| prefix.as_str())
        .unwrap_or_default()
        .to_owned()
    };

    Ok(TxtTransformer { prefix })
  }

  fn transform(
    &self,
    asset: &mut Asset,
    _options: &parcel_plugin::Options,
  ) -> Result<(), Diagnostic> {
    // Emit an ES module that default-exports the text content.
    asset.set_content(format!(
      "export default {:?};\n",
      format!("{}{}", self.prefix, asset.content())
    ));
    asset.set_type("js");
    Ok(())
  }
}

register_plugin!(TxtTransformer);
