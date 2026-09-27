use std::sync::Arc;

use parcel_core::*;
use parcel_js_swc_core::Ast;

pub mod hmr;
mod library_packager;
pub mod packager;
mod transformer;

pub use transformer::JsTransformer;

/// Source text corresponding to locations produced by the JS transformer.
/// Earlier transformers may have rewritten it without providing a source map.
pub fn diagnostic_source(asset: &Asset) -> Option<String> {
  let content = asset.content.downcast_ref::<JsContent>()?;
  // The parser registers its input before any macro-generated source files.
  let files = content.ast.source_map.files();
  let file = files.first()?;
  Some(file.src.to_string())
}

struct JsContent {
  source_size: usize,
  ast: Ast,
  shebang: Option<String>,
  directives: Vec<String>,
  rsc_runtime_dep: Option<u32>,
  needs_filename: bool,
  needs_dirname: bool,
}

impl std::fmt::Debug for JsContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "JsContent")
  }
}

impl Content for JsContent {
  fn estimate_size(&self) -> Result<usize, Diagnostic> {
    Ok(self.source_size)
  }

  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    let (code, _) = self.ast.to_code(false, false)?;
    Ok(code)
  }

  fn ty(&self) -> ContentType {
    parcel_core::content_type!("JsContent")
  }

  fn bundle_dependencies(&self, bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
    packager::bundle_dependencies(bundle_graph, bundle)
  }

  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    if bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
      self.package_library(bundle_graph, bundle, get_inline_bundle_content, options)
    } else {
      self.package_app(bundle_graph, bundle, get_inline_bundle_content, options)
    }
  }
}
