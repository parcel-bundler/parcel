use std::{collections::HashMap, fmt::Write};

use indexmap::{IndexMap, IndexSet};
use parcel_core::{
  Asset, AssetIndex, AssetType, BundleGraph, OutputFormat, ParcelConfig, ParcelOptions, PathId,
  get_bundle_content,
};

use crate::transformer::Ast;
use swc_core::{
  common::{DUMMY_SP, SyntaxContext},
  ecma::{
    ast::{Expr, Ident, MetaPropExpr, MetaPropKind},
    visit::{VisitMut, VisitMutWith},
  },
  quote_expr,
};

use crate::{
  JsContent,
  packager::{
    BundleShim, Resolution, SyntheticAsset, asset_dependencies, insert_hot_update_node_replacements,
  },
};

#[derive(serde::Serialize, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HmrUpdate<'a> {
  Reload,
  #[serde(rename_all = "camelCase")]
  Update {
    assets: Vec<HmrAsset<'a>>,
    /// Set for browsers when code that only runs on the server changed, so pages rendered by it
    /// should be refreshed. See `parcelhmrreload` in the runtime.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    server_changed: bool,
  },
  Error {
    diagnostics: parcel_core::RenderedDiagnostics,
  },
}

#[derive(Debug, serde::Serialize)]
#[serde(untagged)]
enum Id {
  Asset(String),
  Bundle(String),
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HmrAsset<'a> {
  id: Id,
  #[serde(rename = "type")]
  ty: AssetType,
  output: String,
  output_format: OutputFormat,
  deps_by_bundle: HashMap<String, IndexMap<String, Resolution<'a>>>,
}

pub fn get_hmr_update<'a>(
  changed_assets: Vec<(AssetIndex, &'a Asset)>,
  bundle_graph: &'a BundleGraph,
  config: &'a ParcelConfig,
  options: &'a ParcelOptions,
) -> HmrUpdate<'a> {
  let mut synthetic_assets = IndexSet::new();
  let mut esm_sync_bundles = IndexSet::new();
  // Updates re-run modules synchronously, but async modules are evaluated by the runtime's module
  // evaluator (see `tla-runtime.js`).
  if changed_assets
    .iter()
    .any(|(id, _)| bundle_graph.is_async_asset(*id))
  {
    return HmrUpdate::Reload;
  }

  let mut assets = Vec::with_capacity(changed_assets.len());
  for (id, asset) in changed_assets {
    let mut additional_assets = IndexSet::new();
    let dependencies = asset_dependencies(
      id,
      asset,
      bundle_graph,
      None,
      &mut additional_assets,
      &|bundle_index| {
        get_bundle_content(
          config,
          bundle_graph,
          bundle_index,
          options,
          &Default::default(),
        )
      },
      &bundle_graph.project_root,
    )
    .unwrap();

    if asset.target.output_format == OutputFormat::Esmodule {
      for synthetic_asset in &additional_assets {
        if let SyntheticAsset::Bundle {
          bundle,
          kind: BundleShim::Sync,
        } = synthetic_asset
        {
          esm_sync_bundles.insert(*bundle);
        }
      }
    }
    synthetic_assets.extend(additional_assets);

    // TODO: I think we don't need this anymore. Was added in https://github.com/parcel-bundler/parcel/pull/4311
    // due to runtimes producing different dependencies per bundle.
    let mut deps_by_bundle = HashMap::new();
    deps_by_bundle.insert("TODO".into(), dependencies);

    let mut output = String::new();
    if asset.ty == AssetType::Js {
      output = hot_update_code(asset, &bundle_graph.project_root);
    }

    assets.push(HmrAsset {
      id: Id::Asset(asset.id(&bundle_graph.project_root)),
      ty: asset.ty.clone(),
      output,
      output_format: asset.target.output_format.clone(),
      deps_by_bundle,
    });
  }

  // TODO: only changed ones??
  for synthetic_asset in synthetic_assets {
    let esm_sync_bundle = match &synthetic_asset {
      SyntheticAsset::Bundle {
        bundle,
        kind: BundleShim::Sync,
      } if esm_sync_bundles.contains(bundle) => Some(*bundle),
      _ => None,
    };
    let asset_id = synthetic_asset.id(bundle_graph, &bundle_graph.project_root);
    let id = if matches!(synthetic_asset, SyntheticAsset::CssModuleExports(_)) {
      Id::Asset(asset_id.clone())
    } else {
      Id::Bundle(asset_id.clone())
    };

    let mut output = String::new();
    if esm_sync_bundle.is_none() {
      write!(&mut output, "parcelHotUpdate[").unwrap();
      write!(&mut output, "'{}'", asset_id).unwrap();
      write!(&mut output, "] = function (module, exports, require) {{").unwrap();
      synthetic_asset
        .write_content(
          &mut output,
          false,
          bundle_graph,
          &bundle_graph.bundles[0], // TODO
          &|bundle_index| {
            get_bundle_content(
              config,
              bundle_graph,
              bundle_index,
              options,
              &Default::default(),
            )
          },
          &bundle_graph.project_root,
        )
        .unwrap();
      write!(&mut output, "}}").unwrap();
    }

    let mut deps_by_bundle = HashMap::new();
    deps_by_bundle.insert(
      "TODO".into(),
      synthetic_asset.dependencies(bundle_graph, &bundle_graph.project_root),
    );

    assets.push(HmrAsset {
      id,
      // ESM updates cannot introduce a new top-level import. Sending the
      // referenced bundle's non-JS type makes the runtime perform a full reload.
      ty: esm_sync_bundle
        .map(|bundle| bundle_graph.bundles[bundle as usize].ty.clone())
        .unwrap_or(AssetType::Js),
      output,
      output_format: OutputFormat::Esmodule,
      deps_by_bundle,
    });
  }

  HmrUpdate::Update {
    assets,
    server_changed: false,
  }
}

/// Wraps `asset`'s code so that evaluating it registers the new module factory. The runtime evals
/// the update, so its source map is inlined, and the `sourceURL` names the evaluated script in
/// stack traces and devtools.
fn hot_update_code(asset: &Asset, project_root: &PathId) -> String {
  let id = asset.id(project_root);
  let (code, map) = match asset.content.downcast_ref::<JsContent>() {
    Some(content) => {
      let mut ast = content.ast.clone();
      insert_hot_update_node_replacements(&mut ast, content, asset);
      replace_import_meta(&mut ast);
      content
        .to_code(
          &ast,
          asset.target.source_map.is_some(),
          // Resolved from the origin's root, where a bundle in the dist root resolves its
          // `sources` to.
          Some("/"),
          false,
        )
        .unwrap()
    }
    None => (asset.content.read().unwrap(), None),
  };

  // The code starts on its own line so that the map only needs a line offset, and ends on one so
  // that a trailing line comment can't swallow the closing brace.
  let mut output = format!("parcelHotUpdate['{id}'] = function (module, exports, require) {{\n");
  output.push_str(std::str::from_utf8(&code).unwrap());
  output.push_str("\n}");
  if let Some(map) = map {
    // Like a bundle's map (see `SourceMapIndex`).
    let map = format!(
      r#"{{"version":3,"sources":[],"sections":[{{"offset":{{"line":1,"column":0}},"map":{map}}}]}}"#
    );
    write!(
      &mut output,
      "\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,{}\n//# sourceURL={}",
      data_encoding::BASE64.encode(map.as_bytes()),
      hot_update_url(asset, project_root)
    )
    .unwrap();
  }
  output
}

/// The name of `asset`'s hot update in stack traces and devtools: the module's path from the
/// project root, marked so that it isn't mistaken for the module itself.
fn hot_update_url(asset: &Asset, project_root: &PathId) -> String {
  let path = match asset.loc.url.to_file_path() {
    Ok(path) => path.relative(project_root),
    Err(_) => return format!("/{}?hot-update", asset.id(project_root)),
  };
  let path = path
    .components()
    .map(|component| component.as_os_str().to_string_lossy())
    .collect::<Vec<_>>()
    .join("/");
  format!("/{path}?hot-update")
}

/// Replaces `import.meta`, which ESM bundles leave in modules (e.g. `new URL(url, import.meta.url)`),
/// with the `import.meta` of the bundle running the module, since updates aren't evaluated as ES
/// modules.
fn replace_import_meta(ast: &mut Ast) {
  struct ImportMetaReplacer(SyntaxContext);

  impl VisitMut for ImportMetaReplacer {
    fn visit_mut_expr(&mut self, expr: &mut Expr) {
      if let Expr::MetaProp(MetaPropExpr {
        kind: MetaPropKind::ImportMeta,
        ..
      }) = expr
      {
        *expr = *quote_expr!(
          "$module.bundle.importMeta",
          module: Ident = Ident::new("module".into(), DUMMY_SP, self.0)
        );
      } else {
        expr.visit_mut_children_with(self);
      }
    }
  }

  let globals = ast.globals.clone();
  swc_core::common::GLOBALS.set(&globals, || {
    let ctxt = SyntaxContext::empty().apply_mark(ast.unresolved_mark);
    ast.program.visit_mut_with(&mut ImportMetaReplacer(ctxt));
  });
}
