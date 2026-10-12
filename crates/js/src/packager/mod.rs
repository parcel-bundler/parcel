use std::{fmt::Write, sync::Arc};

use indexmap::{IndexMap, IndexSet};
use parcel_core::*;
use parcel_js_swc_core::{
  Ast,
  async_module::wrap_async_module,
  script::{link_script, minify_script},
  tree_shake::tree_shake,
};
use swc_core::{
  common::{DUMMY_SP, SyntaxContext},
  ecma::ast::{
    Expr, Ident, ImportDecl, ImportSpecifier, ImportStarAsSpecifier, ModuleDecl, ModuleItem,
  },
  quote, quote_expr,
};

mod dependencies;
mod printer;
mod rsc;
mod synthetic;

pub use dependencies::asset_dependencies;
pub(crate) use dependencies::bundle_dependencies;
use dependencies::{awaited_bundles, manifest_entries, static_import_ids, static_imports};
pub use parcel_js_swc_core::tree_shake::Resolution;
pub use rsc::RscModule;
use synthetic::AsyncRegistration;
pub use synthetic::{BundleShim, SyntheticAsset};

use crate::JsContent;
use printer::Printer;

const RUNTIME_MODULES: &str = "m";
const RUNTIME_PARCEL_REQUIRE_NAME: &str = "p";
const RUNTIME_EXTERNALS: &str = "x";
const RUNTIME_MANIFEST: &str = "k";
const RUNTIME_ENTRIES: &str = "e";
const RUNTIME_MAIN_ENTRY: &str = "n";
const RUNTIME_AWAITED_BUNDLES: &str = "b";
const RUNTIME_REQUIRE: &str = "r";
const RUNTIME_DIST_DIR: &str = "d";
const RUNTIME_PUBLIC_URL: &str = "u";
const RUNTIME_BUNDLE_URL: &str = "l";
const NODE_PATH: &str = "$parcel$path";
const BUNDLE_DIR: &str = "$parcel$bundleDir";
const IMPORT_META: &str = "$parcel$importMeta";
const RUNTIME_NODE_PATH: &str = "v";
const RUNTIME_BUNDLE_DIR: &str = "w";

fn runtime_name(
  should_optimize: bool,
  dev_name: &'static str,
  optimized_name: &'static str,
) -> &'static str {
  if should_optimize {
    optimized_name
  } else {
    dev_name
  }
}

impl JsContent {
  pub(crate) fn package_app(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    const RUNTIME: &str = include_str!(concat!(env!("OUT_DIR"), "/runtime.min.js"));
    const DEV_RUNTIME: &str = include_str!("../dev-runtime.js");

    let should_build_source_map = bundle.target.source_map.is_some();
    let should_optimize = bundle
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE);

    // A classic script's only asset runs unwrapped, so its top-level declarations are globals (see
    // `package_script`). What its dependencies resolve to goes in the module table before it.
    let script = if bundle.target.source_type == SourceType::Script {
      assert_eq!(bundle.assets.len(), 1);
      Some(bundle.assets[0])
    } else {
      None
    };

    // Resolve dependencies before writing the bundle preamble. Some dependency
    // resolutions, such as synchronous bundles in ESM output, must be emitted
    // as top-level imports before the module table.
    let mut synthetic_assets = IndexSet::new();
    let mut asset_plans = Vec::with_capacity(bundle.assets.len());
    let mut script_dependencies = IndexMap::new();
    for asset_index in &bundle.assets {
      let asset = &bundle_graph.asset_graph.asset(*asset_index);
      let dependencies = asset_dependencies(
        *asset_index,
        asset,
        bundle_graph,
        Some(bundle),
        &mut synthetic_assets,
        get_inline_bundle_content,
        &options.project_root,
      )?;
      if script == Some(*asset_index) {
        script_dependencies = dependencies;
      } else {
        asset_plans.push((*asset_index, dependencies));
      }
    }

    let script = match script {
      Some(asset_index) => {
        let asset = bundle_graph.asset_graph.asset(asset_index);
        let Some(content) = asset.content.downcast_ref::<JsContent>() else {
          return Ok(asset.content.clone());
        };
        let script = package_script(content, asset, bundle, script_dependencies, options)?;
        // Without a module table, the script is the whole bundle.
        if synthetic_assets.is_empty() {
          return Ok(match script.1 {
            Some(map) => Arc::new(ContentWithSourceMap::new(script.0, map.into_bytes())),
            None => Arc::new(BufferContent::new(script.0)),
          });
        }
        Some(script)
      }
      None => None,
    };

    // Async modules are entered through the runtime's module evaluator, and async entries evaluated
    // by it (see `tla-runtime.js`).
    if bundle
      .assets
      .iter()
      .any(|asset| bundle_graph.is_async_asset(*asset))
    {
      synthetic_assets.insert(SyntheticAsset::AsyncEvaluator);
    }
    for entry in &bundle.entry_assets {
      if bundle_graph.is_async_asset(*entry) {
        synthetic_assets.insert(SyntheticAsset::AsyncEntry(*entry));
      }
    }

    let rsc_server_entry =
      if let Some(module) = rsc::server_entry(bundle, bundle_graph, &options.project_root)? {
        let id = module.id(bundle_graph);
        synthetic_assets.insert(SyntheticAsset::Rsc(module));
        Some(id)
      } else {
        None
      };

    let mut printer = Printer::new(should_build_source_map, should_optimize);
    if let Some(main) = bundle.main_entry_asset {
      let asset = &bundle_graph.asset_graph.asset(main);
      if let Some(content) = asset.content.downcast_ref::<JsContent>() {
        if let Some(shebang) = &content.shebang {
          write!(printer, "#!{}\n", shebang)?;
        }
      }
    }

    // A script declares its own (see `package_script`).
    if script.is_none() {
      write_node_replacement_helpers(&mut printer, bundle_graph, bundle, options)?;
    }
    let externals = write_external_imports(&mut printer, bundle_graph, bundle)?;
    let sync_bundles =
      write_sync_bundle_imports(&mut printer, bundle_graph, bundle, &synthetic_assets)?;
    write_bundle_references(&mut printer, bundle_graph, bundle)?;

    // Classic scripts share one global scope (a page's, or a worker's with its `importScripts`), so
    // each keeps its module table and runtime to itself. Bundles link through `globalThis`.
    let is_global = bundle.target.output_format == OutputFormat::Global;
    if is_global {
      printer.write_str("(function(){")?;
    }

    printer.write_var(
      runtime_name(should_optimize, "modules", RUNTIME_MODULES),
      "{",
      false,
    )?;

    let mut first: bool = true;

    for (asset_index, dependencies) in asset_plans {
      let asset = &bundle_graph.asset_graph.asset(asset_index);
      if !first {
        printer.write_char(',')?;
      }
      first = false;

      write_asset_module(
        &mut printer,
        asset,
        bundle,
        bundle_graph.is_async_asset(asset_index),
        dependencies,
        options,
        should_build_source_map,
        should_optimize,
      )?;
    }

    let has_url_references = synthetic_assets.iter().any(|synthetic_asset| {
      matches!(
        synthetic_asset,
        SyntheticAsset::Bundle {
          kind: BundleShim::Url,
          ..
        }
      )
    });
    for synthetic_asset in synthetic_assets {
      if bundle.target.output_format == OutputFormat::Esmodule
        && matches!(
          &synthetic_asset,
          SyntheticAsset::Bundle {
            kind: BundleShim::Sync,
            ..
          }
        )
      {
        continue;
      }

      if !first {
        printer.write_char(',')?;
      }
      first = false;

      write_synthetic_module(
        &mut printer,
        &synthetic_asset,
        bundle_graph,
        bundle,
        get_inline_bundle_content,
        &options.project_root,
        should_optimize,
      )?;
    }

    printer.write_str("};")?;
    printer.newline()?;
    printer.newline()?;

    write_runtime_globals(
      &mut printer,
      bundle_graph,
      bundle,
      rsc_server_entry,
      &externals,
      &sync_bundles,
      has_url_references,
      &options.project_root,
      should_optimize,
      options,
    )?;

    printer.write_str(if should_optimize {
      RUNTIME
    } else {
      DEV_RUNTIME
    })?;
    if is_global {
      printer.write_str("\n})();")?;
    }
    if let Some((code, map)) = script {
      printer.newline()?;
      printer.add_source_map(map)?;
      printer.write_str(std::str::from_utf8(&code).unwrap())?;
    }
    printer.into_content()
  }
}

/// Generates a classic script, linking its dependencies through the global require of the module
/// table before it, and minified without renaming its top-level declarations, which are globals.
fn package_script(
  content: &JsContent,
  asset: &Asset,
  bundle: &Bundle,
  dependencies: IndexMap<String, Resolution<'_>>,
  options: &ParcelOptions,
) -> Result<(Vec<u8>, Option<String>), DiagnosticList> {
  let should_optimize = bundle
    .target
    .flags
    .contains(EnvironmentFlags::SHOULD_OPTIMIZE);
  let mut ast = content.ast.clone();
  insert_node_replacements(&mut ast, content, asset, bundle, should_optimize);
  insert_node_replacement_helpers(
    &mut ast,
    content,
    bundle.target.output_format,
    should_optimize,
  );
  if !dependencies.is_empty() {
    link_script(&mut ast, dependencies, "parcelRequire".into());
  }
  if should_optimize {
    minify_script(&mut ast);
  }
  content.to_code(
    &ast,
    bundle.target.source_map.is_some(),
    bundle_source_root(bundle, &options.project_root).as_deref(),
    should_optimize,
  )
}

fn sync_bundle_binding(bundle: &Bundle) -> String {
  format!("__parcelSyncBundle{:x}", bundle.id)
}

/// Hoists synchronous bundle dependencies in ESM output. They are registered
/// in the runtime's external value map under the synthetic bundle id, allowing
/// transformed `require` calls to resolve them without a nested shim module.
fn write_sync_bundle_imports(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  synthetic_assets: &IndexSet<SyntheticAsset>,
) -> Result<IndexSet<u32>, DiagnosticList> {
  let mut sync_bundles = IndexSet::new();
  if bundle.target.output_format != OutputFormat::Esmodule {
    return Ok(sync_bundles);
  }

  for synthetic_asset in synthetic_assets {
    let SyntheticAsset::Bundle {
      bundle: bundle_index,
      kind: BundleShim::Sync,
    } = synthetic_asset
    else {
      continue;
    };

    let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];
    let specifier = resolved_bundle.relative_specifier(bundle).unwrap();
    write!(
      printer,
      "import {} from {}",
      sync_bundle_binding(resolved_bundle),
      serde_json::to_string(&specifier)?,
    )?;
    if resolved_bundle.ty == AssetType::Json {
      printer.write_str(" with {type:\"json\"};")?;
    } else {
      printer.write_char(';')?;
    }
    printer.newline()?;
    sync_bundles.insert(*bundle_index);
  }

  Ok(sync_bundles)
}

/// Hoists external modules because `require` is unavailable in ESM output.
fn write_external_imports(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<IndexSet<String>, DiagnosticList> {
  let mut externals = IndexSet::new();
  if bundle.target.output_format != OutputFormat::Esmodule {
    return Ok(externals);
  }

  for asset_index in &bundle.assets {
    let asset = &bundle_graph.asset_graph.asset(*asset_index);
    for (dependency_index, dependency) in asset.dependencies.iter().enumerate() {
      if !dependency.flags.contains(DependencyFlags::OPTIONAL)
        && bundle_graph.dependency_resolution(*asset_index, dependency_index)
          == BundleGraphDependencyResolution::External
      {
        externals.insert((*dependency.specifier).to_string());
      }
    }
  }

  for (index, external) in externals.iter().enumerate() {
    write!(
      printer,
      "import * as __parcelExternal{} from {};",
      index,
      serde_json::to_string(external)?
    )?;
    printer.newline()?;
  }

  Ok(externals)
}

/// Writes imports for the bundles this one needs loaded first (see `static_imports`).
fn write_bundle_references(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<(), DiagnosticList> {
  for b in static_imports(bundle_graph, bundle) {
    let referenced = &bundle_graph.bundles[b];
    let specifier = referenced.relative_specifier(bundle).unwrap();
    if bundle.target.output_format == OutputFormat::Commonjs {
      write!(printer, "require({});", serde_json::to_string(&specifier)?)?;
    } else if bundle.target.output_format == OutputFormat::Global
      && bundle.target.environment.is_worker()
    {
      // Classic workers can't `import`, but load scripts synchronously, relative to their own URL.
      write!(
        printer,
        "importScripts({});",
        serde_json::to_string(&specifier)?
      )?;
    } else {
      write!(printer, "import {};", serde_json::to_string(&specifier)?)?;
    }
    printer.newline()?;
  }

  Ok(())
}

fn write_asset_module<'a>(
  printer: &mut Printer,
  asset: &Asset,
  bundle: &Bundle,
  is_async: bool,
  dependencies: IndexMap<String, Resolution<'a>>,
  options: &ParcelOptions,
  should_build_source_map: bool,
  should_optimize: bool,
) -> Result<(), DiagnosticList> {
  if let Some(content) = asset.content.downcast_ref::<JsContent>() {
    let mut ast = content.ast.clone();
    if is_async {
      // The runtime's module evaluator runs it (see `tla-runtime.js`).
      wrap_async_module(
        &mut ast,
        content.esm_prologue_len,
        content.react_refresh_wrapped,
        &static_import_ids(asset, &dependencies),
        asset.flags.contains(AssetFlags::HAS_TOP_LEVEL_AWAIT),
      );
      // Rename bindings so the wrapper's names can't collide with the module's. Optimized output is
      // finalized after tree shaking below.
      if !should_optimize {
        ast.finalize();
      }
    }
    insert_node_replacements(&mut ast, content, asset, bundle, should_optimize);
    let serialized_dependencies = if should_optimize {
      None
    } else {
      Some(serde_json::to_string(&dependencies)?)
    };

    if should_optimize {
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
      tree_shake(
        &mut ast,
        used_symbols,
        dependencies,
        true,
        false,
        RUNTIME_REQUIRE.into(),
      );
      ast.finalize();
    }
    let (code, map) = content.to_code(
      &ast,
      should_build_source_map,
      bundle_source_root(bundle, &options.project_root).as_deref(),
      should_optimize,
    )?;

    printer.write_module_header(asset.id(&options.project_root))?;
    printer.add_source_map(map)?;
    if should_optimize {
      printer.write_expression_code(&code)?;
    } else {
      printer.write_str(std::str::from_utf8(&code).unwrap())?;
      printer.write_module_trailer(serialized_dependencies.unwrap())?;
    }
  } else {
    let (code, map) = (asset.content.read()?, None);
    let deps = serde_json::to_string(&dependencies)?;

    printer.write_module_header(asset.id(&options.project_root))?;
    printer.add_source_map(map)?;
    printer.write_str(std::str::from_utf8(&code).unwrap())?;
    printer.write_module_trailer(deps)?;
  }

  Ok(())
}

fn write_node_replacement_helpers(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  options: &ParcelOptions,
) -> Result<(), DiagnosticList> {
  let should_optimize = bundle
    .target
    .flags
    .contains(EnvironmentFlags::SHOULD_OPTIMIZE);
  // Hot updates may add modules that need the helpers (see `insert_hot_update_node_replacements`).
  let hot_updates_need_helpers =
    options.hmr.is_some() && !should_optimize && bundle.target.environment.is_node();
  if !hot_updates_need_helpers
    && !bundle.assets.iter().any(|asset_index| {
      bundle_graph
        .asset_graph
        .asset(*asset_index)
        .flags
        .contains(AssetFlags::HAS_NODE_REPLACEMENTS)
    })
  {
    return Ok(());
  }

  let path = runtime_name(should_optimize, NODE_PATH, RUNTIME_NODE_PATH);
  let bundle_dir = runtime_name(should_optimize, BUNDLE_DIR, RUNTIME_BUNDLE_DIR);
  if bundle.target.output_format == OutputFormat::Esmodule {
    writeln!(printer, "import * as {path} from 'path';")?;
    printer.write_var(bundle_dir, "import.meta.dirname", true)?;
  } else {
    printer.write_var(path, "module.require('path')", true)?;
    printer.write_var(bundle_dir, "__dirname", true)?;
  }

  Ok(())
}

pub(super) fn insert_node_replacements(
  ast: &mut Ast,
  content: &JsContent,
  asset: &Asset,
  bundle: &Bundle,
  should_optimize: bool,
) {
  let bundle_dir = bundle
    .dist_path()
    .parent()
    .unwrap_or(bundle.target.dist_dir);
  insert_node_replacement_decls(ast, content, asset, bundle_dir, |ctxt, value| {
    let path = Ident::new(
      runtime_name(should_optimize, NODE_PATH, RUNTIME_NODE_PATH).into(),
      DUMMY_SP,
      ctxt,
    );
    let bundle_dir = Ident::new(
      runtime_name(should_optimize, BUNDLE_DIR, RUNTIME_BUNDLE_DIR).into(),
      DUMMY_SP,
      ctxt,
    );
    quote_expr!(
      "$path.resolve($bundle_dir, $value)",
      path: Ident = path,
      bundle_dir: Ident = bundle_dir,
      value: Expr = value.into()
    )
  });
}

/// Like `insert_node_replacements`, for a module in a hot update. Updates are evaluated outside of
/// the bundles they apply to, so the bundle's helpers are reached through `module.bundle` (see the
/// dev runtime), and the paths are relative to the dist root because the
/// module may be in bundles in different directories.
pub(crate) fn insert_hot_update_node_replacements(
  ast: &mut Ast,
  content: &JsContent,
  asset: &Asset,
) {
  insert_node_replacement_decls(ast, content, asset, asset.target.dist_dir, |ctxt, value| {
    let module = Ident::new("module".into(), DUMMY_SP, ctxt);
    quote_expr!(
      "$module.bundle.nodePath.resolve($module.bundle.bundleDir, $module.bundle.distDir, $value)",
      module: Ident = module,
      value: Expr = value.into()
    )
  });
}

/// Declares the `__filename` and `__dirname` that a Node module uses, with values that `resolve`
/// creates from their paths relative to `from`.
fn insert_node_replacement_decls(
  ast: &mut Ast,
  content: &JsContent,
  asset: &Asset,
  from: PathId,
  resolve: impl Fn(SyntaxContext, String) -> Box<Expr>,
) {
  if !content.needs_filename && !content.needs_dirname {
    return;
  }

  let globals = ast.globals.clone();
  swc_core::common::GLOBALS.set(&globals, || {
    let ctxt = SyntaxContext::empty().apply_mark(ast.unresolved_mark);
    let (filename, dirname) = node_replacement_paths(asset, from);
    let mut items = Vec::with_capacity(2);

    if content.needs_filename {
      let name = Ident::new("__filename".into(), DUMMY_SP, ctxt);
      items.push(quote!(
        "var $name = $value" as ModuleItem,
        name: Ident = name,
        value: Expr = *resolve(ctxt, filename)
      ));
    }

    if content.needs_dirname {
      let name = Ident::new("__dirname".into(), DUMMY_SP, ctxt);
      items.push(quote!(
        "var $name = $value" as ModuleItem,
        name: Ident = name,
        value: Expr = *resolve(ctxt, dirname)
      ));
    }

    ast.program.body.splice(0..0, items);
  });
}

pub(super) fn insert_node_replacement_helpers(
  ast: &mut Ast,
  content: &JsContent,
  output_format: OutputFormat,
  should_optimize: bool,
) {
  if !content.needs_filename && !content.needs_dirname {
    return;
  }

  let globals = ast.globals.clone();
  swc_core::common::GLOBALS.set(&globals, || {
    let ctxt = SyntaxContext::empty().apply_mark(ast.unresolved_mark);
    let path = Ident::new(
      runtime_name(should_optimize, NODE_PATH, RUNTIME_NODE_PATH).into(),
      DUMMY_SP,
      ctxt,
    );
    let bundle_dir = Ident::new(
      runtime_name(should_optimize, BUNDLE_DIR, RUNTIME_BUNDLE_DIR).into(),
      DUMMY_SP,
      ctxt,
    );
    let mut items = Vec::new();

    if output_format == OutputFormat::Esmodule {
      items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        src: Box::new("path".into()),
        phase: Default::default(),
        span: DUMMY_SP,
        specifiers: vec![ImportSpecifier::Namespace(ImportStarAsSpecifier {
          span: DUMMY_SP,
          local: path.clone(),
        })],
        type_only: false,
        with: None,
      })));
      items.push(quote!(
        "var $bundle_dir = import.meta.dirname" as ModuleItem,
        bundle_dir: Ident = bundle_dir,
      ));
    } else {
      let require = Ident::new("require".into(), DUMMY_SP, ctxt);
      items.push(quote!(
        "var $path = $require($value)" as ModuleItem,
        path: Ident = path,
        require: Ident = require,
        value: Expr = "path".into()
      ));
      let dirname = Ident::new("__dirname".into(), DUMMY_SP, ctxt);
      items.push(quote!(
        "var $bundle_dir = $dirname" as ModuleItem,
        bundle_dir: Ident = bundle_dir,
        dirname: Ident = dirname
      ));
    }

    ast.program.body.splice(0..0, items);
  });
}

/// The paths of `asset`'s file and directory relative to the directory `from`.
fn node_replacement_paths(asset: &Asset, from: PathId) -> (String, String) {
  let from = SourceUrl::from_directory_path(&from);

  if let Ok(filename) = asset.loc.url.to_file_path() {
    let dirname = filename.parent().unwrap_or(filename);
    let filename = SourceUrl::from_path(&filename)
      .relative(&from)
      .unwrap_or_else(|| filename.to_path_buf().to_string_lossy().into_owned());
    let dirname = SourceUrl::from_directory_path(&dirname)
      .relative(&from)
      .unwrap_or_else(|| dirname.to_path_buf().to_string_lossy().into_owned());
    (filename, dirname)
  } else {
    let filename = asset
      .loc
      .url
      .relative(&from)
      .unwrap_or_else(|| asset.loc.url.to_string());
    (filename.clone(), filename)
  }
}

fn write_synthetic_module(
  printer: &mut Printer,
  synthetic_asset: &SyntheticAsset,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  project_root: &PathId,
  should_optimize: bool,
) -> Result<(), DiagnosticList> {
  let id = synthetic_asset.id(bundle_graph, project_root);
  let registration = synthetic_asset.async_registration(bundle_graph, bundle, project_root);
  printer.write_module_header(id)?;
  if should_optimize {
    printer.write_str("function(module,exports){")?;
  }
  if let Some(registration) = &registration {
    printer.write_str(&async_module_header(
      registration,
      runtime_name(should_optimize, "require", RUNTIME_REQUIRE),
    )?)?;
  }
  synthetic_asset.write_content(
    printer,
    should_optimize,
    bundle_graph,
    bundle,
    get_inline_bundle_content,
    project_root,
  )?;
  let deps = serde_json::to_string(&synthetic_asset.dependencies(bundle_graph, project_root))?;
  if registration.is_some() {
    printer.write_str(ASYNC_MODULE_FOOTER)?;
  }
  if should_optimize {
    printer.write_char('}')?;
  } else {
    printer.write_module_trailer(deps)?;
  }

  Ok(())
}

fn write_runtime_globals(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  rsc_server_entry: Option<String>,
  externals: &IndexSet<String>,
  sync_bundles: &IndexSet<u32>,
  has_url_references: bool,
  project_root: &PathId,
  should_optimize: bool,
  options: &ParcelOptions,
) -> Result<(), DiagnosticList> {
  printer.write_var(
    runtime_name(
      should_optimize,
      "parcelRequireName",
      RUNTIME_PARCEL_REQUIRE_NAME,
    ),
    "'parcelRequire'",
    true,
  )?;
  printer.write_var(
    runtime_name(should_optimize, "externals", RUNTIME_EXTERNALS),
    "{",
    false,
  )?;
  for (index, external) in externals.iter().enumerate() {
    write!(
      printer,
      "{}:__parcelExternal{},",
      serde_json::to_string(external)?,
      index
    )?;
  }
  for bundle_index in sync_bundles {
    write!(
      printer,
      "{:?}:{},",
      BundleShim::Sync.id(*bundle_index, bundle_graph),
      sync_bundle_binding(&bundle_graph.bundles[*bundle_index as usize]),
    )?;
  }
  printer.write_str("};")?;
  printer.newline()?;

  printer.write_var(
    runtime_name(should_optimize, "manifest", RUNTIME_MANIFEST),
    "{",
    false,
  )?;
  for (stable_key, name) in manifest_entries(bundle_graph, bundle) {
    write!(
      printer,
      "{}:{},",
      serde_json::to_string(&stable_key)?,
      serde_json::to_string(&name)?
    )?;
  }
  printer.write_str("};")?;
  printer.newline()?;

  // The path from this bundle's directory back to the dist root. Bundle ids passed to
  // parcelLoadJS are dist-root-relative, so the runtime resolves them against this prefix.
  let dist_dir_prefix = dist_dir_prefix(
    &bundle.target.dist_dir,
    &bundle.dist_path().parent().unwrap(),
  );
  printer.write_var(
    runtime_name(should_optimize, "distDir", RUNTIME_DIST_DIR),
    &serde_json::to_string(&dist_dir_prefix)?,
    true,
  )?;

  let mut public_url = bundle.target.public_url.clone();
  if !public_url.ends_with('/') {
    public_url.push('/');
  }
  printer.write_var(
    runtime_name(should_optimize, "publicUrl", RUNTIME_PUBLIC_URL),
    &serde_json::to_string(&public_url)?,
    true,
  )?;

  // In Node, URLs to other bundles (e.g. `new URL('./file.txt', import.meta.url)`) refer to their
  // files rather than public URLs, so the runtime resolves them against this bundle's file URL.
  // Hot updates may add references to bundles that had none.
  let may_reference_urls = has_url_references || (options.hmr.is_some() && !should_optimize);
  let bundle_url = match bundle.target.environment {
    Environment::Node | Environment::ElectronMain if may_reference_urls => {
      if bundle.target.output_format == OutputFormat::Esmodule {
        "import.meta.url"
      } else {
        "module.require('url').pathToFileURL(__filename).href"
      }
    }
    _ => "null",
  };
  printer.write_var(
    runtime_name(should_optimize, "bundleUrl", RUNTIME_BUNDLE_URL),
    bundle_url,
    true,
  )?;

  printer.write_var(
    runtime_name(should_optimize, "entries", RUNTIME_ENTRIES),
    "[",
    false,
  )?;
  if let Some(entry) = rsc_server_entry {
    write!(printer, "'{}',", entry)?;
  }
  // A classic script's entry runs after the module table rather than from it.
  let is_script = bundle.target.source_type == SourceType::Script;
  for entry in bundle.entry_assets.iter().filter(|_| !is_script) {
    write!(
      printer,
      "'{}',",
      entry_id(bundle_graph, *entry, project_root)
    )?;
  }

  printer.write_str("];")?;
  printer.newline()?;

  printer.write_var(
    runtime_name(should_optimize, "awaitedBundles", RUNTIME_AWAITED_BUNDLES),
    "[",
    false,
  )?;
  for index in awaited_bundles(bundle_graph, bundle) {
    let stable_key = bundle_graph.bundles[index].stable_key();
    write!(printer, "{},", serde_json::to_string(&stable_key)?)?;
  }
  printer.write_str("];")?;
  printer.newline()?;

  // The runtime runs its main entry on load, to expose its exports. Only bundles that execute on
  // load may do that: a bundle loaded by Parcel's loader runs once every bundle it depends on has
  // loaded, which the loader waits for, and it doesn't import them itself.
  let runtime_main_entry = runtime_name(should_optimize, "mainEntry", RUNTIME_MAIN_ENTRY);
  if let Some(main) = bundle
    .main_entry_asset
    .as_ref()
    .filter(|_| !bundle.entry_assets.is_empty() && !is_script)
  {
    printer.write_var(
      runtime_main_entry,
      &format!("'{}'", entry_id(bundle_graph, *main, project_root)),
      true,
    )?;
  } else {
    printer.write_var(runtime_main_entry, "null", true)?;
  }

  if !should_optimize {
    printer.write_var(
      "HMR_ENABLED",
      if options.hmr.is_some() {
        "true"
      } else {
        "false"
      },
      true,
    )?;
    // Hot updates are evaluated outside of the bundle, so the runtime exposes its `import.meta` to
    // them (see `replace_import_meta`).
    if options.hmr.is_some() && bundle.target.output_format == OutputFormat::Esmodule {
      printer.write_var(IMPORT_META, "import.meta", true)?;
    }
    if let Some(hmr) = &options.hmr {
      // A wildcard address such as 0.0.0.0 is where the server listens, not an address clients can
      // connect to (Safari refuses to), so the runtime uses the page's host instead.
      let is_wildcard = hmr
        .host
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_unspecified());
      let host = if is_wildcard {
        "null".into()
      } else {
        serde_json::to_string(&hmr.host)?
      };
      printer.write_var("HMR_HOST", &host, true)?;
      printer.write_var("HMR_PORT", &serde_json::to_string(&hmr.port)?, true)?;
    } else {
      printer.write_var("HMR_HOST", "null", true)?;
      printer.write_var("HMR_PORT", "null", true)?;
    }
  }

  Ok(())
}

/// Starts the content of a synthetic module that the runtime's async module evaluator runs, like an
/// asset module wrapped by `wrap_async_module`. Its link code runs first, then the evaluator enters
/// its imports, then its content runs, before it waits for them. `ASYNC_MODULE_FOOTER` ends it.
fn async_module_header(
  registration: &AsyncRegistration,
  require: &str,
) -> Result<String, DiagnosticList> {
  Ok(format!(
    "{require}(\"_tla\").enter(module,{},0,async function($parcel$tla){{try{{{}var $parcel$wait=$parcel$tla();\n",
    serde_json::to_string(&registration.imports)?,
    registration.link,
  ))
}

const ASYNC_MODULE_FOOTER: &str = "\n;if($parcel$wait)(await $parcel$wait)();$parcel$tla.d()}catch($parcel$error){$parcel$tla.c($parcel$error)}});";

/// The id the runtime requires to run an entry. For an async entry, that's a shim evaluating it,
/// which exposes a promise for its exports.
fn entry_id(bundle_graph: &BundleGraph, entry: AssetIndex, project_root: &PathId) -> String {
  if bundle_graph.is_async_asset(entry) {
    SyntheticAsset::AsyncEntry(entry).id(bundle_graph, project_root)
  } else {
    bundle_graph.asset_graph.asset(entry).id(project_root)
  }
}

fn dist_dir_prefix(dist_dir: &PathId, bundle_dir: &PathId) -> String {
  let mut prefix = SourceUrl::from_directory_path(dist_dir)
    .relative(&SourceUrl::from_directory_path(bundle_dir))
    .unwrap();
  if !prefix.starts_with('.') {
    prefix.insert_str(0, "./");
  }
  if !prefix.ends_with('/') {
    prefix.push('/');
  }
  prefix
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;

  #[test]
  fn dist_dir_prefix_is_directory_relative_and_ends_in_slash() {
    let dist_dir = PathId::new(Path::new("/project/dist"));

    assert_eq!(dist_dir_prefix(&dist_dir, &dist_dir), "./");
    assert_eq!(dist_dir_prefix(&dist_dir, &dist_dir.child("client")), "../");
    assert_eq!(
      dist_dir_prefix(
        &dist_dir,
        &dist_dir.child("client").child("routes").child("nested")
      ),
      "../../../"
    );
  }
}
