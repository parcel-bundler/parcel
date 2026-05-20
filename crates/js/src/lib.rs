use std::sync::Mutex;

use parcel_core::*;
use parcel_js_swc_core::Ast;

mod library_packager;
pub mod packager;
mod transformer;

pub use library_packager::LibraryPackager;
pub use packager::JsPackager;
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
}
