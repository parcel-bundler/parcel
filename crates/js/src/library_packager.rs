use std::sync::Arc;

use crate::packager::tree_shake::tree_shake;
use fixedbitset::FixedBitSet;
use indexmap::IndexSet;
use parcel_core::*;

use swc_core::{
  common::DUMMY_SP,
  ecma::ast::{Expr, ExprStmt, ImportDecl, Lit, ModuleDecl, ModuleItem, Stmt},
  quote,
};

use crate::{
  JsContent,
  packager::{asset_dependencies, insert_node_replacement_helpers, insert_node_replacements},
};

impl JsContent {
  pub(crate) fn package_library(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = &bundle_graph
      .asset_graph
      .asset(bundle.main_entry_asset.unwrap());
    let mut synthetic_assets = IndexSet::new();
    let dependencies = asset_dependencies(
      bundle.main_entry_asset.unwrap(),
      asset,
      bundle_graph,
      Some(bundle),
      &mut synthetic_assets,
      get_inline_bundle_content,
      &options.project_root,
    )?;

    let (code, map) = if let Some(content) = asset.content.downcast_ref::<JsContent>() {
      let mut ast = content.ast.clone();
      if let Some(shebang) = &content.shebang {
        ast.program.shebang = Some(shebang.as_str().into());
      }

      let mut macro_imports = Vec::new();
      let mut imported_bundles = FixedBitSet::with_capacity(bundle_graph.bundles.len());
      for (dep_index, dep) in asset.dependencies.iter().enumerate() {
        if dep.flags.contains(DependencyFlags::MACRO) {
          if let BundleGraphDependencyResolution::Bundle { bundle_index, .. } =
            bundle_graph.dependency_resolution(bundle.main_entry_asset.unwrap(), dep_index)
          {
            if imported_bundles.contains(bundle_index as usize) {
              continue;
            }
            imported_bundles.insert(bundle_index as usize);

            let resolved_bundle = &bundle_graph.bundles[bundle_index as usize];
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

      let should_optimize = bundle
        .target
        .flags
        .contains(EnvironmentFlags::SHOULD_OPTIMIZE);
      insert_node_replacements(&mut ast, content, asset, bundle, should_optimize);
      insert_node_replacement_helpers(
        &mut ast,
        content,
        bundle.target.output_format,
        should_optimize,
      );

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
      // println!("{:?} {:?} {:?}", asset.loc.url, used_symbols, dependencies);
      tree_shake(
        &mut ast,
        used_symbols,
        dependencies,
        false,
        true,
        "require".into(),
      );
      hoist_directives(&mut ast.program.body, &content.directives);
      ast.finalize();
      content.to_code(
        &ast,
        bundle.target.source_map.is_some(),
        bundle_source_root(bundle, &options.project_root).as_deref(),
        false,
      )?
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

/// Moves the asset's directives (e.g. "use client") back to the start of the module. Statements
/// inserted while transforming and packaging (CommonJS interop, macro imports, Node replacements)
/// push them down, where they are no longer directives.
fn hoist_directives(body: &mut [ModuleItem], directives: &[String]) {
  if directives.is_empty() {
    return;
  }

  let is_directive = |item: &ModuleItem, directive: &String| match item {
    ModuleItem::Stmt(Stmt::Expr(ExprStmt { expr, .. })) => {
      matches!(&**expr, Expr::Lit(Lit::Str(s)) if s.value.to_string_lossy() == *directive)
    }
    _ => false,
  };
  let Some(start) = body.windows(directives.len()).position(|items| {
    items
      .iter()
      .zip(directives)
      .all(|(item, directive)| is_directive(item, directive))
  }) else {
    return;
  };
  body[..start + directives.len()].rotate_right(directives.len());
}
