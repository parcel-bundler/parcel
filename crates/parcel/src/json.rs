use std::fmt::Write;
use std::sync::Arc;

use parcel_core::{AssetType, BufferContent, DiagnosticList, OutputFormat, Transformer};

pub struct JsonTransformer {}

impl Transformer for JsonTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _options: &parcel_core::ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<parcel_core::Asset, DiagnosticList> {
    let content = asset.content.read()?;
    let code = std::str::from_utf8(&content)?;
    let json: serde_json::Value = serde_json::from_str(code)?;
    let js = json_to_js(json, asset.target.output_format)?;

    asset.ty = AssetType::Js;
    asset.content = Arc::new(BufferContent::new_string(js));
    Ok(asset)
  }
}

pub fn json_to_js(
  json: serde_json::Value,
  output_format: OutputFormat,
) -> Result<String, DiagnosticList> {
  if output_format == OutputFormat::Esmodule {
    if let serde_json::Value::Object(obj) = json {
      let mut js = String::new();
      let mut default = String::new();
      for (count, (k, v)) in obj.iter().enumerate() {
        let key = format!("_export{}", count);
        write!(&mut js, "const {} = {};\n", key, serde_json::to_string(&v)?)?;
        if k != "default" {
          write!(&mut js, "export {{{} as {:?}}};\n", key, k)?;
        }
        write!(&mut default, "{:?}: {},", k, key)?;
      }
      js.push_str("export default {");
      js.push_str(&default);
      js.push_str("};\n");
      Ok(js)
    } else {
      Ok(format!(
        "export default {};\n",
        serde_json::to_string(&json)?
      ))
    }
  } else {
    Ok(format!(
      "module.exports = {};\n",
      serde_json::to_string(&json)?
    ))
  }
}
