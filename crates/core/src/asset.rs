use std::{path::Path, sync::Arc};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{BundleBehavior, Environment, SourceLocation, impl_bitflags_serde};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  // pub file_path: Interned<PathBuf>,
  pub loc: Option<SourceLocation>,
  #[serde(rename = "type")]
  pub ty: AssetType,
  #[serde(with = "serde_bytes")]
  pub content: Vec<u8>,
  pub env: Arc<Environment>,
  // pub query: Option<String>,
  pub pipeline: Option<String>,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  // pub symbols: Vec<Symbol>,
  pub unique_key: Option<String>,
}

impl Asset {
  pub fn file_path(&self) -> &Path {
    self
      .loc
      .as_ref()
      .map(|l| l.file_path.as_path())
      .unwrap_or(Path::new("")) // TODO
  }
}

#[derive(Debug, Clone, PartialEq, Hash)]
pub enum AssetType {
  Js,
  Jsx,
  Ts,
  Tsx,
  Css,
  Html,
  Xhtml,
  Svg,
  Json,
  Jsonld,
  Other(Box<str>),
}

impl Serialize for AssetType {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.extension().serialize(serializer)
  }
}

impl<'de> Deserialize<'de> for AssetType {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let ext: String = Deserialize::deserialize(deserializer)?;
    Ok(Self::from_extension(&ext))
  }
}

impl AssetType {
  pub fn extension(&self) -> &str {
    match self {
      AssetType::Js => "js",
      AssetType::Jsx => "jsx",
      AssetType::Ts => "ts",
      AssetType::Tsx => "tsx",
      AssetType::Css => "css",
      AssetType::Html => "html",
      AssetType::Xhtml => "xhtml",
      AssetType::Svg => "svg",
      AssetType::Json => "json",
      AssetType::Jsonld => "jsonld",
      AssetType::Other(s) => s,
    }
  }

  pub fn from_extension(ext: &str) -> AssetType {
    match ext {
      "js" => AssetType::Js,
      "jsx" => AssetType::Jsx,
      "ts" => AssetType::Ts,
      "tsx" => AssetType::Tsx,
      "css" => AssetType::Css,
      "html" => AssetType::Html,
      "xhtml" => AssetType::Xhtml,
      "svg" => AssetType::Svg,
      "json" => AssetType::Json,
      "jsonld" => AssetType::Jsonld,
      ext => AssetType::Other(ext.to_owned().into_boxed_str()),
    }
  }

  pub fn from_path(path: &Path) -> AssetType {
    if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
      AssetType::from_extension(ext)
    } else {
      AssetType::Other("".into())
    }
  }

  pub fn from_mime(mime: &str) -> AssetType {
    match mime {
      // https://mimesniff.spec.whatwg.org/#javascript-mime-type
      "application/ecmascript" => AssetType::Js,
      "application/javascript" => AssetType::Js,
      "application/x-ecmascript" => AssetType::Js,
      "application/x-javascript" => AssetType::Js,
      "text/ecmascript" => AssetType::Js,
      "text/javascript" => AssetType::Js,
      "text/javascript1.0" => AssetType::Js,
      "text/javascript1.1" => AssetType::Js,
      "text/javascript1.2" => AssetType::Js,
      "text/javascript1.3" => AssetType::Js,
      "text/javascript1.4" => AssetType::Js,
      "text/javascript1.5" => AssetType::Js,
      "text/jscript" => AssetType::Js,
      "text/livescript" => AssetType::Js,
      "text/x-ecmascript" => AssetType::Js,
      "text/x-javascript" => AssetType::Js,
      "module" => AssetType::Js,
      "application/json" => AssetType::Json,
      "application/ld+json" => AssetType::Jsonld,
      "text/css" => AssetType::Css,
      "text/html" => AssetType::Html,
      "application/xhtml+xml" => AssetType::Xhtml,
      "image/svg+xml" => AssetType::Svg,
      mime => AssetType::Other(
        mime
          .split('/')
          .nth(1)
          .map(|m| m.to_owned())
          .unwrap_or_else(|| mime.to_owned())
          .into_boxed_str(),
      ),
    }
  }
}

bitflags! {
  #[derive(Debug, Clone, Copy)]
  pub struct AssetFlags: u32 {
    const IS_SOURCE = 1 << 0;
    const SIDE_EFFECTS = 1 << 1;
    const IS_BUNDLE_SPLITTABLE = 1 << 2;
    const LARGE_BLOB = 1 << 3;
    const HAS_CJS_EXPORTS = 1 << 4;
    const STATIC_EXPORTS = 1 << 5;
    const SHOULD_WRAP = 1 << 6;
    const IS_CONSTANT_MODULE = 1 << 7;
    const HAS_NODE_REPLACEMENTS = 1 << 8;
    const HAS_SYMBOLS = 1 << 9;
    const IS_HTML_ATTR = 1 << 10;
    const IS_HTML_TAG = 1 << 11;
  }
}

impl_bitflags_serde!(AssetFlags);
