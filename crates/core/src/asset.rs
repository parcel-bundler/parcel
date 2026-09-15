use std::{
  hash::{Hash, Hasher},
  path::Path,
  sync::Arc,
};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{
  AssetGraph, AssetIndex, BundleBehavior, Content, Dependency, PathId, SourceLocation, SourceUrl,
  Target, impl_bitflags_serde,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
  pub loc: SourceLocation,
  #[serde(rename = "type")]
  pub ty: AssetType,
  pub content: Arc<dyn Content>,
  pub target: Arc<Target>,
  pub pipeline: Option<hstr::Atom>,
  pub bundle_behavior: BundleBehavior,
  pub flags: AssetFlags,
  pub unique_key: Option<Arc<str>>,
  pub dependencies: Vec<Dependency>,
  pub symbols: AssetSymbols,
}

#[derive(Hash, PartialEq, Eq, Clone, Debug)]
pub struct AssetKey {
  pub loc: SourceLocation,
  pub ty: AssetType,
  pub target: Arc<Target>,
  pub pipeline: Option<hstr::Atom>,
  pub bundle_behavior: BundleBehavior,
  pub unique_key: Option<Arc<str>>,
  /// Included so that when a package's `sideEffects` flag changes across incremental builds,
  /// the differently-flagged asset gets its own slot instead of overwriting the other's.
  pub side_effects: bool,
}

impl Asset {
  pub fn id(&self, project_root: &PathId) -> String {
    format!("{:016x}", self.id_u64(project_root))
  }

  pub fn id_u64(&self, project_root: &PathId) -> u64 {
    let mut hasher = xxhash_rust::xxh3::Xxh3Default::new();
    self.stable_hash(project_root, &mut hasher);
    hasher.digest()
  }

  pub fn stable_hash<H: Hasher>(&self, project_root: &PathId, state: &mut H) {
    self.loc.stable_hash(project_root, state);
    self.ty.hash(state);
    self.target.stable_hash(project_root, state);
    self.pipeline.hash(state);
    self.bundle_behavior.hash(state);
    self.unique_key.hash(state);
  }

  pub fn key(&self) -> AssetKey {
    AssetKey {
      loc: self.loc.clone(),
      ty: self.ty.clone(),
      target: self.target.clone(),
      pipeline: self.pipeline.clone(),
      bundle_behavior: self.bundle_behavior.clone(),
      unique_key: self.unique_key.clone(),
      side_effects: self.flags.contains(AssetFlags::SIDE_EFFECTS),
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum AssetType {
  Js,
  Jsx,
  Ts,
  Tsx,
  Mdx,
  Css,
  StyleAttribute,
  Sass,
  Scss,
  Html,
  Xhtml,
  Svg,
  Json,
  Jsonld,
  Toml,
  Yaml,
  Png,
  Jpeg,
  Gif,
  WebP,
  Tiff,
  Bmp,
  Ico,
  Avif,
  Other(hstr::Atom),
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
      AssetType::Mdx => "mdx",
      AssetType::Css => "css",
      AssetType::StyleAttribute => "style", // ???
      AssetType::Sass => "sass",
      AssetType::Scss => "scss",
      AssetType::Html => "html",
      AssetType::Xhtml => "xhtml",
      AssetType::Svg => "svg",
      AssetType::Json => "json",
      AssetType::Jsonld => "jsonld",
      AssetType::Yaml => "yaml",
      AssetType::Toml => "toml",
      AssetType::Png => "png",
      AssetType::Jpeg => "jpg",
      AssetType::Gif => "gif",
      AssetType::WebP => "webp",
      AssetType::Tiff => "tiff",
      AssetType::Bmp => "bmp",
      AssetType::Ico => "ico",
      AssetType::Avif => "avif",
      AssetType::Other(s) => s,
    }
  }

  pub fn from_extension(ext: &str) -> AssetType {
    match ext {
      "js" => AssetType::Js,
      "jsx" => AssetType::Jsx,
      "mjs" => AssetType::Js,
      "cjs" => AssetType::Js,
      "ts" => AssetType::Ts,
      "tsx" => AssetType::Tsx,
      "mdx" => AssetType::Mdx,
      "css" => AssetType::Css,
      "style" => AssetType::StyleAttribute,
      "sass" => AssetType::Sass,
      "scss" => AssetType::Scss,
      "html" | "htm" => AssetType::Html,
      "xhtml" => AssetType::Xhtml,
      "svg" => AssetType::Svg,
      "json" => AssetType::Json,
      "jsonld" => AssetType::Jsonld,
      "yaml" => AssetType::Yaml,
      "yml" => AssetType::Yaml,
      "toml" => AssetType::Toml,
      "png" => AssetType::Png,
      "jpeg" => AssetType::Jpeg,
      "jpg" => AssetType::Jpeg,
      "gif" => AssetType::Gif,
      "webp" => AssetType::WebP,
      "tiff" => AssetType::Tiff,
      "bmp" => AssetType::Bmp,
      "ico" => AssetType::Ico,
      "avif" => AssetType::Avif,
      ext => AssetType::Other(ext.into()),
    }
  }

  pub fn from_path(path: &Path) -> AssetType {
    if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
      AssetType::from_extension(ext)
    } else {
      AssetType::Other("".into())
    }
  }

  pub fn from_url(url: &SourceUrl) -> AssetType {
    AssetType::from_extension(url.extension())
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
      "application/yaml" => AssetType::Yaml,
      "application/toml" => AssetType::Toml,
      "text/css" => AssetType::Css,
      "text/sass" => AssetType::Sass,
      "text/scss" => AssetType::Scss,
      "text/html" => AssetType::Html,
      "application/xhtml+xml" => AssetType::Xhtml,
      "image/svg+xml" => AssetType::Svg,
      "image/png" => AssetType::Png,
      "image/jpeg" => AssetType::Jpeg,
      "image/gif" => AssetType::Gif,
      "image/webp" => AssetType::WebP,
      "image/tiff" => AssetType::Tiff,
      "image/bmp" => AssetType::Bmp,
      "image/x-icon" | "image/vnd.microsoft.icon" => AssetType::Ico,
      "image/avif" => AssetType::Avif,
      mime => AssetType::Other(
        mime
          .split('/')
          .nth(1)
          .map(|m| m.into())
          .unwrap_or_else(|| mime.into()),
      ),
    }
  }

  pub fn mime(&self) -> &'static str {
    match self {
      AssetType::Js => "application/javascript",
      AssetType::Jsx => "application/javascript",
      AssetType::Ts => "application/javascript",
      AssetType::Tsx => "application/javascript",
      AssetType::Mdx => "application/javascript",
      AssetType::Css => "text/css",
      AssetType::StyleAttribute => todo!(),
      AssetType::Sass => "text/sass",
      AssetType::Scss => "text/scss",
      AssetType::Html => "text/html",
      AssetType::Xhtml => "application/xhtml+xml",
      AssetType::Svg => "image/svg+xml",
      AssetType::Json => "application/json",
      AssetType::Jsonld => "application/json",
      AssetType::Yaml => "application/yaml",
      AssetType::Toml => "application/toml",
      AssetType::Png => "image/png",
      AssetType::Jpeg => "image/jpeg",
      AssetType::Gif => "image/gif",
      AssetType::WebP => "image/webp",
      AssetType::Tiff => "image/tiff",
      AssetType::Bmp => "image/bmp",
      AssetType::Ico => "image/x-icon",
      AssetType::Avif => "image/avif",
      AssetType::Other(_) => "application/octet-stream",
    }
  }

  pub fn is_js(&self) -> bool {
    use AssetType::*;
    // SVG is included because it can be compiled to a React component (JSX),
    // in which case its output format matters for dep propagation.
    matches!(self, Js | Jsx | Ts | Tsx | Mdx | Json | Toml | Yaml | Svg)
  }

  pub fn is_binary(&self) -> bool {
    use AssetType::*;
    matches!(self, Png | Jpeg | Gif | WebP | Bmp | Ico | Avif | Other(..))
  }
}

bitflags! {
  #[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
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
    const IS_ESM = 1 << 12;
    const AUTOMATIC_JSX_RUNTIME = 1 << 13;
  }
}

impl_bitflags_serde!(AssetFlags);

#[derive(Debug, Clone, Default, Serialize)]
pub struct AssetSymbols {
  pub used_namespace: bool,
  pub imports: Vec<ImportedSymbol>,
  pub exports: Vec<LocalSymbol>,
  pub indirect: Vec<IndirectSymbol>,
  pub star: Vec<StarSymbol>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportedSymbol {
  pub dep_index: u32,
  pub symbol: SymbolName,
  pub resolved: SymbolResolution,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub enum SymbolResolution {
  None,
  Ambiguous,
  Export {
    asset_index: AssetIndex,
    export_index: u32,
  },
  Namespace {
    asset_index: AssetIndex,
  },
  Runtime {
    asset_index: AssetIndex,
    name: SymbolName,
  },
}

impl SymbolResolution {
  pub fn asset_index(&self) -> Option<AssetIndex> {
    match self {
      SymbolResolution::None | SymbolResolution::Ambiguous => None,
      SymbolResolution::Export { asset_index, .. }
      | SymbolResolution::Namespace { asset_index }
      | SymbolResolution::Runtime { asset_index, .. } => Some(*asset_index),
    }
  }

  pub fn name(&self, asset_graph: &AssetGraph) -> Option<SymbolName> {
    match self {
      SymbolResolution::None | SymbolResolution::Ambiguous => None,
      SymbolResolution::Export {
        asset_index,
        export_index,
      } => {
        let asset = asset_graph.asset(*asset_index);
        let export = &asset.symbols.exports[*export_index as usize];
        Some(export.exported.clone())
      }
      SymbolResolution::Namespace { .. } => Some(SymbolName::Namespace),
      SymbolResolution::Runtime { name, .. } => Some(name.clone()),
    }
  }

  pub fn is_used(&self, asset_graph: &AssetGraph) -> bool {
    match self {
      SymbolResolution::Export {
        asset_index,
        export_index,
      } => asset_graph.asset(*asset_index).symbols.exports[*export_index as usize].requested,
      SymbolResolution::Runtime { asset_index, name } => {
        let symbols = &asset_graph.asset(*asset_index).symbols;
        symbols.used_namespace
          || symbols
            .exports
            .iter()
            .find(|export| export.exported == *name)
            .map(|export| export.requested)
            .or_else(|| {
              symbols
                .indirect
                .iter()
                .find(|export| export.exported == *name)
                .map(|export| export.requested)
            })
            .unwrap_or(true)
      }
      SymbolResolution::Namespace { asset_index } => {
        let symbols = &asset_graph.asset(*asset_index).symbols;
        symbols.used_namespace
      }
      _ => true,
    }
  }
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalSymbol {
  pub exported: SymbolName,
  pub requested: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndirectSymbol {
  pub exported: SymbolName,
  pub dep_index: u32,
  pub imported: SymbolName,
  pub requested: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StarSymbol {
  pub dep_index: u32,
  pub requested: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub enum SymbolName {
  Namespace,
  // AllButDefault,
  Default,
  Name(hstr::Atom),
}

impl From<&str> for SymbolName {
  fn from(value: &str) -> Self {
    match value {
      "*" => SymbolName::Namespace,
      "default" => SymbolName::Default,
      _ => SymbolName::Name(value.into()),
    }
  }
}

impl From<String> for SymbolName {
  fn from(value: String) -> Self {
    match value.as_str() {
      "*" => SymbolName::Namespace,
      "default" => SymbolName::Default,
      _ => SymbolName::Name(value.into()),
    }
  }
}

impl From<hstr::Atom> for SymbolName {
  fn from(value: hstr::Atom) -> Self {
    match &*value {
      "*" => SymbolName::Namespace,
      "default" => SymbolName::Default,
      _ => SymbolName::Name(value),
    }
  }
}

impl SymbolName {
  pub fn as_str(&self) -> &str {
    match self {
      SymbolName::Namespace => "*",
      SymbolName::Default => "default",
      SymbolName::Name(name) => &*name,
    }
  }
}
