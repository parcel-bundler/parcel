use std::sync::Arc;

use parcel_core::{Asset, AssetType, DiagnosticList, Transformer};
use serde_json::Value;

use crate::json_urls::JsonUrlContent;

// Properties whose values may contain ImageObjects or URLs, as in the v2 transformer.
const SCHEMA_ATTRS: &[&str] = &[
  "logo",
  "photo",
  "image",
  "thumbnail",
  "screenshot",
  "primaryImageOfPage",
  "embedUrl",
  "thumbnailUrl",
  "video",
  "contentUrl",
  "url",
];

pub struct JsonLdTransformer {}

impl Transformer for JsonLdTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _ctx: &parcel_core::PluginContext,
  ) -> Result<Asset, DiagnosticList> {
    let source = asset.content.read()?;
    let json = serde_json::from_slice(&source)?;
    let mut pointers = Vec::new();
    collect_urls(&json, String::new(), &mut pointers);
    let mut content = JsonUrlContent {
      json,
      urls: Vec::new(),
      source_size: source.len(),
    };
    for pointer in pointers {
      content.add_url(&mut asset, pointer, None);
    }
    asset.ty = AssetType::Jsonld;
    asset.content = Arc::new(content);
    Ok(asset)
  }
}

fn collect_urls(value: &Value, pointer: String, urls: &mut Vec<String>) {
  match value {
    Value::String(_) => urls.push(pointer),
    Value::Array(array) => {
      for (index, value) in array.iter().enumerate() {
        collect_urls(value, format!("{pointer}/{index}"), urls);
      }
    }
    Value::Object(object) => {
      for (key, value) in object {
        if SCHEMA_ATTRS.contains(&key.as_str()) {
          collect_urls(value, format!("{pointer}/{key}"), urls);
        }
      }
    }
    _ => {}
  }
}
