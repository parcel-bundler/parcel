use parcel_plugin::{Asset, Diagnostic, Plugin, register_plugin};

/// Prepends a line to each asset, such as a license comment or a polyfill
/// import, and keeps the source map an earlier transformer attached, so the
/// bundle still maps back to the original files.
struct PrependTransformer {
  line: String,
}

impl Plugin for PrependTransformer {
  fn new(config: &[u8]) -> Result<Self, Diagnostic> {
    let config: serde_json::Value = if config.is_empty() {
      serde_json::Value::Null
    } else {
      serde_json::from_slice(config).map_err(|e| Diagnostic::new(e.to_string()))?
    };
    let line = config
      .get("line")
      .and_then(|line| line.as_str())
      .unwrap_or("/* Built with Parcel */")
      .to_owned();
    Ok(PrependTransformer { line })
  }

  fn transform(
    &self,
    asset: &mut Asset,
    _options: &parcel_plugin::Options,
  ) -> Result<(), Diagnostic> {
    let content = format!("{}\n{}", self.line, asset.content());

    // Without a map, Parcel maps the asset as if this content were its source.
    let Some(map) = asset.source_map() else {
      asset.set_content(content);
      return Ok(());
    };

    // Everything moved down a line. In VLQ mappings each `;` starts the next
    // generated line, so an empty one in front shifts the rest.
    let mut map: serde_json::Value =
      serde_json::from_str(&map).map_err(|e| Diagnostic::new(e.to_string()))?;
    if let Some(mappings) = map["mappings"].as_str() {
      map["mappings"] = format!(";{mappings}").into();
    }
    asset.set_content_with_map(content, map.to_string());
    Ok(())
  }
}

register_plugin!(PrependTransformer);
