use parcel_plugin::{Asset, CodeFrame, Config, Diagnostic, LogLevel, Options, Plugin, register_plugin};

/// Prepends a line to each asset, such as a license comment or a polyfill
/// import, and keeps the source map an earlier transformer attached, so the
/// bundle still maps back to the original files.
///
/// The line is the `line` option, or the contents of the file the `file` option
/// names, relative to the .parcelrc.
struct PrependTransformer {
  line: String,
}

impl Plugin for PrependTransformer {
  fn new(config: &Config, options: &Options) -> Result<Self, Diagnostic> {
    let value: serde_json::Value = if config.bytes().is_empty() {
      serde_json::Value::Null
    } else {
      serde_json::from_slice(config.bytes()).map_err(|e| Diagnostic::new(e.to_string()))?
    };

    if let Some(file) = value.get("file").and_then(|file| file.as_str()) {
      // Read through Parcel, so that editing the file rebuilds with its new contents.
      let path = config.resolve_path(file);
      let line = options.read_to_string(&path).map_err(|e| {
        Diagnostic::new(format!("Could not read {}: {e}", path.display())).with_code_frame(CodeFrame::file(config.path()))
      })?;
      options.log(
        LogLevel::Verbose,
        format!("prepend-transformer: read {}", path.display()),
      );
      return Ok(PrependTransformer {
        line: line.trim_end().to_owned(),
      });
    }

    let line = value
      .get("line")
      .and_then(|line| line.as_str())
      .unwrap_or("/* Built with Parcel */")
      .to_owned();
    Ok(PrependTransformer { line })
  }

  fn transform(&self, asset: &mut Asset, _options: &Options) -> Result<(), Diagnostic> {
    let content = format!("{}\n{}", self.line, asset.content()?);

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
