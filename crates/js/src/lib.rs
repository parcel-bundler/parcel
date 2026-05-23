use std::sync::{Arc, Mutex};

use parcel_core::*;
use parcel_js_swc_core::Ast;

mod library_packager;
pub mod packager;
mod transformer;

pub use transformer::JsTransformer;

struct JsContent {
  ast: Mutex<Ast>,
  shebang: Option<String>,
  directives: Vec<String>,
}

impl std::fmt::Debug for JsContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "JsContent")
  }
}

impl Content for JsContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    let (code, _) = self.ast.lock().unwrap().to_code(false, false)?;
    Ok(code)
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
