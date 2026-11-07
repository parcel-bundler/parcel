use std::{
  borrow::Cow,
  collections::{HashMap, HashSet},
  fmt::Write,
};

use indexmap::{IndexMap, IndexSet};
use parcel_core::{
  Asset, AssetIndex, AssetType, BundleGraph, OutputFormat, ParcelConfig, ParcelOptions, PathId,
  get_bundle_content,
};

use crate::transformer::Ast;
use parcel_css::css_module_export_sources;
use swc_core::{
  common::{DUMMY_SP, SyntaxContext},
  ecma::{
    ast::{Expr, Ident, MetaPropExpr, MetaPropKind},
    visit::{VisitMut, VisitMutWith},
  },
  quote_expr,
};

use crate::{
  JsContent, JsOutput,
  packager::{
    BundleShim, MapJson, Resolution, SectionMap, SourceMapSection, SyntheticAsset,
    asset_dependencies, embedded_css_modules, insert_hot_update_node_replacements,
    source_map_index, write_node_replacement_decls,
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
  /// For a changed asset that isn't JS or CSS, the sync shim ids of the bundles containing it. It
  /// only affects a page that imports one of them (see `externals` in the runtime).
  #[serde(skip_serializing_if = "Option::is_none")]
  bundles: Option<Vec<String>>,
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

  // JS bundles embed the class names of the CSS modules they import, so a change to a CSS module,
  // or to one it composes from, updates their exports even if no JS changed.
  if changed_assets.iter().any(|(_, asset)| {
    asset.ty != AssetType::Js && asset.symbols.exports.iter().any(|e| e.requested)
  }) {
    let changed: HashSet<AssetIndex> = changed_assets.iter().map(|&(id, _)| id).collect();
    let mut checked = HashSet::new();
    for bundle in &bundle_graph.bundles {
      if bundle.ty != AssetType::Js {
        continue;
      }
      for css_module in embedded_css_modules(bundle_graph, bundle) {
        if checked.insert(css_module)
          && css_module_export_sources(&bundle_graph.asset_graph, css_module)
            .iter()
            .any(|source| changed.contains(source))
        {
          synthetic_assets.insert(SyntheticAsset::CssModuleExports(css_module));
        }
      }
    }
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

    let bundles = (asset.ty != AssetType::Js && asset.ty != AssetType::Css).then(|| {
      bundle_graph
        .bundles
        .iter()
        .enumerate()
        .filter(|(_, bundle)| bundle.assets.contains(&id))
        .map(|(index, _)| {
          SyntheticAsset::Bundle {
            bundle: index as u32,
            kind: BundleShim::Sync,
          }
          .id(bundle_graph, &bundle_graph.project_root)
        })
        .collect()
    });

    assets.push(HmrAsset {
      id: Id::Asset(asset.id(&bundle_graph.project_root)),
      ty: asset.ty.clone(),
      output,
      output_format: asset.target.output_format.clone(),
      deps_by_bundle,
      bundles,
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
      // referenced bundle's non-JS type makes the runtime perform a full reload,
      // unless a bundle on the page already imports it.
      ty: esm_sync_bundle
        .map(|bundle| bundle_graph.bundles[bundle as usize].ty.clone())
        .unwrap_or(AssetType::Js),
      output,
      output_format: OutputFormat::Esmodule,
      deps_by_bundle,
      bundles: None,
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
  let source_maps = asset.target.source_map.is_some();
  // Resolved from the origin's root, where a bundle in the dist root resolves its `sources` to.
  let source_root = "/";
  // Code before the module's own, outside of its source map.
  let mut prefix = String::new();
  let (code, map): (Cow<'_, [u8]>, Option<SectionMap>) = match asset
    .content
    .downcast_ref::<JsContent>()
  {
    Some(content) => match &content.output {
      JsOutput::Ast { ast, .. } => {
        let mut ast = ast.clone();
        insert_hot_update_node_replacements(&mut ast, content, asset);
        replace_import_meta(&mut ast);
        let (code, map) = content
          .to_code(&ast, source_maps, Some(source_root), false)
          .unwrap();
        (Cow::Owned(code), map.map(SectionMap::new))
      }
      // Modules that use `import.meta` keep their AST when hot updates are enabled (see
      // `JsContent::keeps_ast`), so this only needs the Node replacements.
      JsOutput::Code(generated) => {
        write_node_replacement_decls(
          &mut prefix,
          content,
          asset,
          asset.target.dist_dir,
          |value| {
            format!(
              "module.bundle.nodePath.resolve(module.bundle.bundleDir, module.bundle.distDir, {value})"
            )
          },
        );
        let map = generated
          .map
          .as_ref()
          .filter(|_| source_maps)
          .map(|json| SectionMap {
            json: MapJson::Shared(json.clone()),
            source_root: Some(source_root.into()),
          });
        (Cow::Borrowed(generated.code.as_bytes()), map)
      }
    },
    None => (Cow::Owned(asset.content.read().unwrap()), None),
  };

  // The code starts on its own line so that the map only needs a line offset, and ends on one so
  // that a trailing line comment can't swallow the closing brace.
  let mut output = format!("parcelHotUpdate['{id}'] = function (module, exports, require) {{\n");
  output.push_str(&prefix);
  output.push_str(std::str::from_utf8(&code).unwrap());
  output.push_str("\n}");
  if let Some(map) = map {
    // Like a bundle's map.
    let map = source_map_index(vec![SourceMapSection {
      line: 1 + prefix.matches('\n').count() as u32,
      column: 0,
      map,
    }])
    .to_string();
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
