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
    asset.content = Arc::new(BufferContent::new(js.into_bytes()));
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
      let mut count = 0;
      for (k, v) in &obj {
        if is_valid_js_identifier(&k) {
          write!(
            &mut js,
            "export const {} = {};\n",
            k,
            serde_json::to_string(&v)?
          )?;
          write!(&mut default, "{},", k)?;
        } else {
          let mut key = format!("_export{}", count);
          while obj.contains_key(&key) {
            count += 1;
            key = format!("_export{}", count);
          }

          write!(&mut js, "const {} = {};\n", key, serde_json::to_string(&v)?)?;
          write!(&mut js, "export {{{} as {:?}}}\n;", key, k)?;
          write!(&mut default, "{:?}: {},", k, key)?;
          count += 1;
        }
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

fn is_valid_js_identifier(s: &str) -> bool {
  // Reserved keywords (partial list)
  const RESERVED: &[&str] = &[
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "let",
    "static",
    "enum",
    "await",
  ];

  if RESERVED.contains(&s) {
    return false;
  }

  let mut chars = s.chars();

  let first = match chars.next() {
    Some(c) => c,
    None => return false,
  };

  // First character
  if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
    return false;
  }

  // Remaining characters
  chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}
