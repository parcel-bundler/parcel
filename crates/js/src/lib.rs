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
  /// See `parcel_js_swc_core::async_module::wrap_async_module`.
  esm_prologue_len: usize,
  react_refresh_wrapped: bool,
  /// The map from an earlier transformer, composed into this asset's generated map when packaging.
  input_source_map: Option<InputSourceMap>,
}

impl JsContent {
  /// Generates code for `ast` (this asset's AST, possibly modified for packaging),
  /// with its source map composed through the asset's input map. The map's `sources` are relative
  /// to the project root, which `source_root` is the path to (see `bundle_source_root`).
  fn to_code(
    &self,
    ast: &Ast,
    source_maps: bool,
    source_root: Option<&str>,
    minify: bool,
  ) -> Result<(Vec<u8>, Option<String>), DiagnosticList> {
    let (code, map) = ast.to_code(source_maps, source_root, minify)?;
    let (Some(map), Some(input)) = (&map, &self.input_source_map) else {
      return Ok((code, map));
    };
    // The parser registers the asset's own file first; macros may add more.
    let source = self
      .ast
      .source_map
      .files()
      .first()
      .map(|f| f.name.to_string());
    let map = match source {
      Some(source) => compose_source_map(map, &source, input, source_root)?,
      None => map.clone(),
    };
    Ok((code, Some(map)))
  }
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
    let (code, _) = self.ast.to_code(false, None, false)?;
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
