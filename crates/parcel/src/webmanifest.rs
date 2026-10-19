use std::sync::Arc;

use parcel_core::{
  Asset, AssetType, CodeFrame, CodeHighlight, Diagnostic, DiagnosticList, Location, SourceLocation,
  Transformer,
};
use serde_json::Value;

use crate::json_urls::JsonUrlContent;

pub struct WebManifestTransformer {}

impl Transformer for WebManifestTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _ctx: &parcel_core::PluginContext,
  ) -> Result<Asset, DiagnosticList> {
    let source = asset.content.read_string()?.into_owned();
    let json: Value = serde_json::from_str(&source)?;
    let map = json_sourcemap::parse(&source, Default::default())?;
    let mut urls = Vec::new();
    let mut errors = Vec::new();
    collect_resources(&json, &mut urls, &mut errors);
    if !errors.is_empty() {
      let mut diagnostic = Diagnostic::from_message("Invalid webmanifest".into());
      diagnostic.origin = Some("@parcel/transformer-webmanifest".into());
      diagnostic.code_frames.push(CodeFrame {
        code: Some(source),
        url: Some(asset.loc.url.clone()),
        language: Some(AssetType::Json),
        code_highlights: errors
          .into_iter()
          .map(|(pointer, message)| {
            let loc = map.get_location(&pointer).unwrap();
            CodeHighlight::from_json(loc.value(), loc.value_end(), Some(message))
          })
          .collect(),
      });
      return Err(diagnostic.into());
    }

    let mut content = JsonUrlContent {
      json,
      urls: Vec::new(),
      source_size: source.len(),
    };
    for pointer in urls {
      let loc = map.get_location(&pointer).unwrap();
      let source_location = SourceLocation {
        url: asset.loc.url.clone(),
        start: Location {
          line: loc.value().line as u32 + 1,
          column: loc.value().column as u32 + 1,
        },
        end: Location {
          line: loc.value_end().line as u32 + 1,
          column: loc.value_end().column as u32 + 1,
        },
      };
      content.add_url(&mut asset, pointer, Some(source_location));
    }
    asset.ty = AssetType::from_extension("webmanifest");
    asset.content = Arc::new(content);
    Ok(asset)
  }
}

fn collect_resources(
  json: &Value,
  urls: &mut Vec<String>,
  errors: &mut Vec<(String, &'static str)>,
) {
  if !json.is_object() {
    errors.push((String::new(), "Expected type object"));
    return;
  }
  for key in ["icons", "screenshots"] {
    if let Some(list) = json.get(key) {
      resource_list(list, format!("/{key}"), urls, errors);
    }
  }
  for key in ["shortcuts", "file_handlers"] {
    if let Some(list) = json.get(key) {
      let Some(list) = list.as_array() else {
        errors.push((format!("/{key}"), "Expected type array"));
        continue;
      };
      for (index, item) in list.iter().enumerate() {
        let pointer = format!("/{key}/{index}");
        if !item.is_object() {
          errors.push((pointer, "Expected type object"));
        } else if let Some(icons) = item.get("icons") {
          resource_list(icons, format!("{pointer}/icons"), urls, errors);
        }
      }
    }
  }
}

fn resource_list(
  list: &Value,
  pointer: String,
  urls: &mut Vec<String>,
  errors: &mut Vec<(String, &'static str)>,
) {
  let Some(list) = list.as_array() else {
    errors.push((pointer, "Expected type array"));
    return;
  };
  for (index, item) in list.iter().enumerate() {
    let pointer = format!("{pointer}/{index}");
    if !item.is_object() {
      errors.push((pointer, "Expected type object"));
      continue;
    }
    match item.get("src") {
      None => errors.push((pointer, "Missing property src")),
      Some(Value::String(src)) if src.is_empty() => {
        errors.push((format!("{pointer}/src"), "Must not be empty"));
      }
      Some(Value::String(_)) => urls.push(format!("{pointer}/src")),
      Some(_) => errors.push((format!("{pointer}/src"), "Expected type string")),
    }
  }
}
