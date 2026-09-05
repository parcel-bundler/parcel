use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
};

use lightningcss::{
  css_modules::{CssModuleExport, CssModuleReference},
  error::Error,
  stylesheet::{StyleAttribute, StyleSheet},
};
use parcel_core::*;

mod packager;
mod transformer;

pub use transformer::{CssTransformer, StyleAttrTransformer};

use crate::transformer::PseudoClasses;

#[derive(Debug)]
pub struct CssContent {
  stylesheet: StyleSheet<'static>,
  exports: HashMap<String, CssModuleExport>,
  references: HashMap<String, usize>,
  pseudo_classes: Option<Arc<PseudoClasses>>,
}

impl Content for CssContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    todo!()
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    self.package_impl(bundle_graph, bundle, get_inline_bundle_content, options)
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("CssContent")
  }
}

pub fn resolve_css_module_export(
  asset_graph: &AssetGraph,
  asset_index: AssetIndex,
  name: &str,
) -> Option<String> {
  resolve_css_module_export_inner(asset_graph, asset_index, name, &mut HashSet::new())
}

fn resolve_css_module_export_inner<'a>(
  asset_graph: &'a AssetGraph,
  asset_index: AssetIndex,
  name: &'a str,
  seen: &mut HashSet<(AssetIndex, &'a str)>,
) -> Option<String> {
  let key = (asset_index, name);
  if !seen.insert(key) {
    return None;
  }

  let asset = &asset_graph.asset(asset_index);
  let Some(content) = asset.content.downcast_ref::<CssContent>() else {
    seen.remove(&key);
    return None;
  };

  let res = if let Some(export) = content.exports.get(name) {
    let mut res = export.name.clone();
    for composes in &export.composes {
      res.push(' ');
      match composes {
        CssModuleReference::Global { name } => {
          res.push_str(name);
        }
        CssModuleReference::Local { name } => {
          if let Some((local_name, _)) = content
            .exports
            .iter()
            .find(|(_, export)| export.name == name.as_str())
            && let Some(resolved) =
              resolve_css_module_export_inner(asset_graph, asset_index, local_name, seen)
          {
            res.push_str(&resolved);
          } else {
            res.push_str(name);
          }
        }
        CssModuleReference::Dependency { name, specifier } => {
          if let Some(dep) = asset
            .dependencies
            .iter()
            .find(|d| &*d.specifier == &*specifier && d.specifier_type == SpecifierType::Esm)
          {
            if let Some((resolved, _)) = asset_graph.resolved_asset(dep) {
              if let Some(resolved) =
                resolve_css_module_export_inner(asset_graph, resolved, name, seen)
              {
                res.push_str(&resolved);
              }
            }
          }
        }
      }
    }

    Some(res)
  } else {
    None
  };

  seen.remove(&key);
  res
}

fn convert_version(c: Version) -> u32 {
  ((c.major() as u32) << 16) | ((c.minor() as u32) << 8)
}

fn convert_error<T: std::fmt::Display>(url: Option<SourceUrl>, err: Error<T>) -> Diagnostic {
  Diagnostic {
    origin: Some("@parcel/transformer-css".into()),
    message: err.to_string(),
    code_frames: if let Some(loc) = err.loc {
      vec![CodeFrame {
        code: None,
        code_highlights: vec![CodeHighlight {
          message: None,
          start: Location {
            line: loc.line,
            column: loc.column,
          },
          end: Location {
            line: loc.line,
            column: loc.column,
          },
        }],
        language: None,
        url,
      }]
    } else {
      Vec::new()
    },
    hints: Vec::new(),
    documentation_url: None,
    severity: DiagnosticSeverity::Error,
  }
}

struct StyleAttrContent {
  attr: StyleAttribute<'static>,
}

impl std::fmt::Debug for StyleAttrContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "todo")
  }
}

impl Content for StyleAttrContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    todo!()
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    self.package_impl(bundle_graph, bundle, get_inline_bundle_content, options)
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("StyleAttrContent")
  }
}
