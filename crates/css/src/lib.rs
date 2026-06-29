use std::{collections::HashMap, sync::Arc};

use lightningcss::{
  css_modules::{CssModuleExport, CssModuleReference},
  error::Error,
  stylesheet::{StyleAttribute, StyleSheet},
};
use parcel_core::*;

mod packager;
mod transformer;

pub use transformer::{CssTransformer, StyleAttrTransformer};

#[derive(Debug)]
pub struct CssContent {
  stylesheet: StyleSheet<'static>,
  exports: HashMap<String, CssModuleExport>,
  references: HashMap<String, usize>,
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
}

pub fn resolve_css_module_export(
  assets: &[AssetNode],
  asset_index: usize,
  name: &str,
) -> Option<String> {
  let AssetNode::Asset(asset) = &assets[asset_index] else {
    return None;
  };

  let Some(content) = asset.content.downcast_ref::<CssContent>() else {
    return None;
  };

  if let Some(export) = content.exports.get(name) {
    let mut res = export.name.clone();
    for composes in &export.composes {
      res.push(' ');
      match composes {
        CssModuleReference::Global { name } => {
          res.push_str(name);
        }
        CssModuleReference::Local { name } => {
          if let Some(resolved) = resolve_css_module_export(assets, asset_index, name) {
            res.push_str(&resolved);
          }
        }
        CssModuleReference::Dependency { name, specifier } => {
          if let Some(dep) = asset
            .dependencies
            .iter()
            .find(|d| d.specifier == *specifier && d.specifier_type == SpecifierType::Esm)
          {
            if let DependencyResolution::Asset(resolved) = dep.resolution {
              if let Some(resolved) = resolve_css_module_export(assets, resolved as usize, name) {
                res.push_str(&resolved);
              }
            }
          }
        }
      }
    }

    return Some(res);
  }

  None
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
}
