use std::sync::Arc;

use fixedbitset::FixedBitSet;
use indexmap::IndexSet;
use parcel_core::*;
use parcel_js_swc_core::tree_shake::tree_shake;

use swc_core::{
  common::DUMMY_SP,
  ecma::ast::{ImportDecl, ModuleDecl, ModuleItem},
  quote,
};

use crate::{JsContent, packager::asset_dependencies};

impl JsContent {
  pub(crate) fn package_library(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    _options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = bundle_graph.asset_graph.assets[bundle.main_entry_asset.unwrap()].expect_asset();
    let mut synthetic_assets = IndexSet::new();
    let dependencies = asset_dependencies(
      asset,
      bundle_graph,
      bundle,
      &mut synthetic_assets,
      get_inline_bundle_content,
    )?;

    let (code, map) = if let Some(content) = asset.content.downcast_ref::<JsContent>() {
      let mut ast = content.ast.lock().unwrap();
      if let Some(shebang) = &content.shebang {
        ast.program.shebang = Some(shebang.as_str().into());
      }

      let mut macro_imports = Vec::new();
      let mut imported_bundles = FixedBitSet::with_capacity(bundle_graph.bundles.len());
      for dep in &asset.dependencies {
        if dep.flags.contains(DependencyFlags::MACRO) {
          if let DependencyResolution::Bundle(bundle_index) = &dep.resolution {
            if imported_bundles.contains(*bundle_index as usize) {
              continue;
            }
            imported_bundles.insert(*bundle_index as usize);

            let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];
            if let Some(url) = resolved_bundle.relative_specifier(bundle) {
              if bundle.target.output_format == OutputFormat::Esmodule {
                macro_imports.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                  src: Box::new(url.into()),
                  phase: Default::default(),
                  span: DUMMY_SP,
                  specifiers: Vec::new(),
                  type_only: false,
                  with: None,
                })));
              } else {
                macro_imports.push(quote!("require($url)" as ModuleItem, url: Expr = url.into()));
              }
            }
          }
        }
      }

      if !macro_imports.is_empty() {
        ast.program.body.splice(0..0, macro_imports);
      }

      let used_symbols = asset
        .symbols
        .exports
        .iter()
        .filter_map(|e| {
          if e.requested {
            Some(e.exported.as_str().into())
          } else {
            None
          }
        })
        .chain(asset.symbols.indirect.iter().filter_map(|e| {
          if e.requested {
            Some(e.exported.as_str().into())
          } else {
            None
          }
        }))
        .collect();
      let dirname = asset
        .loc
        .url
        .parent()
        .unwrap()
        .relative(&bundle.target.dist_dir)
        .unwrap()
        .into();
      // println!("{:?} {:?} {:?}", asset.loc.url, used_symbols, dependencies);
      tree_shake(&mut ast, used_symbols, dependencies, dirname, false);
      ast.to_code(bundle.target.source_map.is_some(), false)?
    } else {
      (asset.content.read()?, None)
    };

    if let Some(map) = map {
      Ok(Arc::new(ContentWithSourceMap::new(code, map.into_bytes())))
    } else {
      Ok(Arc::new(BufferContent::new(code)))
    }
  }
}
