use std::{hash::Hash, path::Path, sync::Arc};

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

use crate::{
  BundleBehavior, Content, Dependency, DependencyFlags, DependencyResolution, PathId,
  SourceLocation, SourceUrl, Target, impl_bitflags_serde,
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
  pub unique_key: Option<String>,
  pub dependencies: Vec<Dependency>,
  pub symbols: AssetSymbols,
}

impl Asset {
  pub fn id(&self, project_root: &PathId) -> String {
    let mut hasher = xxhash_rust::xxh3::Xxh3Default::new();
    self.loc.stable_hash(project_root, &mut hasher);
    self.ty.hash(&mut hasher);
    self.target.stable_hash(project_root, &mut hasher);
    self.pipeline.hash(&mut hasher);
    self.bundle_behavior.hash(&mut hasher);
    self.flags.hash(&mut hasher);
    self.unique_key.hash(&mut hasher);
    format!("{:016x}", hasher.digest())
  }

  /// Iterates over all resolved asset indices that this asset depends on, in dependency order.
  /// NOTE: This may include duplicates. self.symbols.imports must be sorted by dep_index.
  pub fn resolved_dependencies(&self) -> impl Iterator<Item = u32> {
    let mut dep_index = 0;
    let mut import_index = 0;
    std::iter::from_fn(move || {
      loop {
        // If a dependency has side effects, emit its resolved asset.
        // If the namespace of this asset is used, include all dependencies.
        // If the dependency is referenced by a used indirect or star export,
        if dep_index < self.dependencies.len() {
          let dep = &self.dependencies[dep_index];
          if dep.flags.contains(DependencyFlags::SIDE_EFFECTS)
            || self.symbols.used_namespace
            // TODO: check
            || self
              .symbols
              .indirect
              .iter()
              .any(|i| i.dep_index == dep_index as u32 && i.requested)
            || self
              .symbols
              .star
              .iter()
              .any(|i| i.dep_index == dep_index as u32 && i.requested)
          {
            if let DependencyResolution::Asset(asset) = dep.resolution {
              dep_index += 1;
              return Some(asset);
            }
          }
        }

        // Emit all resolved assets for imported symbols in this dependency.
        // Side-effect free re-exports are not included - they are referenced directly through their importers.
        while import_index < self.symbols.imports.len() {
          let import = &self.symbols.imports[import_index];
          if import.dep_index > dep_index as u32 {
            break;
          }

          if let Some(asset) = import.resolved.asset_index() {
            import_index += 1;
            return Some(asset);
          }

          import_index += 1;
        }

        // Continue looping while there are more dependencies.
        if dep_index < self.dependencies.len() {
          dep_index += 1;
          continue;
        }

        return None;
      }
    })
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
  #[derive(Debug, Clone, Copy, Hash)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum SymbolResolution {
  None,
  Ambiguous,
  Export { asset_index: u32, export_index: u32 },
  Namespace { asset_index: u32 },
  Runtime { asset_index: u32, name: SymbolName },
}

impl SymbolResolution {
  pub fn asset_index(&self) -> Option<u32> {
    match self {
      SymbolResolution::None | SymbolResolution::Ambiguous => None,
      SymbolResolution::Export { asset_index, .. }
      | SymbolResolution::Namespace { asset_index }
      | SymbolResolution::Runtime { asset_index, .. } => Some(*asset_index),
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
