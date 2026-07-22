use std::{fmt::Write, sync::Arc};

use indexmap::IndexSet;
use parcel_core::*;
use parcel_js_swc_core::{Ast, tree_shake::tree_shake};
use swc_core::{
  common::{DUMMY_SP, SyntaxContext},
  ecma::ast::{Ident, ImportDecl, ImportSpecifier, ImportStarAsSpecifier, ModuleDecl, ModuleItem},
  quote,
};

mod dependencies;
mod printer;
mod rsc;
mod synthetic;

pub use dependencies::asset_dependencies;
pub use parcel_js_swc_core::tree_shake::Resolution;
pub use rsc::RscModule;
pub use synthetic::{BundleShim, SyntheticAsset};

use crate::JsContent;
use printer::Printer;

const RUNTIME_MODULES: &str = "m";
const RUNTIME_PARCEL_REQUIRE_NAME: &str = "p";
const RUNTIME_EXTERNALS: &str = "x";
const RUNTIME_ENTRIES: &str = "e";
const RUNTIME_MAIN_ENTRY: &str = "n";
const RUNTIME_REQUIRE: &str = "r";
const RUNTIME_DIST_DIR: &str = "d";
const RUNTIME_PUBLIC_URL: &str = "u";
const NODE_PATH: &str = "$parcel$path";
const BUNDLE_DIR: &str = "$parcel$bundleDir";
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

    if bundle.target.source_type == SourceType::Script {
      assert_eq!(bundle.assets.len(), 1);
      let asset = &bundle_graph
        .asset_graph
        .asset(bundle.main_entry_asset.unwrap());
      if let Some(content) = asset.content.downcast_ref::<JsContent>() {
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
        let (code, map) = ast.to_code(bundle.target.source_map.is_some(), false)?;
        if let Some(map) = map {
          return Ok(Arc::new(ContentWithSourceMap::new(code, map.into_bytes())));
        }

        return Ok(Arc::new(BufferContent::new(code)));
      }

      return Ok(asset.content.clone());
    }

    let should_build_source_map = bundle.target.source_map.is_some();
    let should_optimize = bundle
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE);

    let mut printer = Printer::new(should_build_source_map, should_optimize);
    if let Some(main) = bundle.main_entry_asset {
      let asset = &bundle_graph.asset_graph.asset(main);
      if let Some(content) = asset.content.downcast_ref::<JsContent>() {
        if let Some(shebang) = &content.shebang {
          write!(printer, "#!{}\n", shebang)?;
        }
      }
    }

    write_node_replacement_helpers(&mut printer, bundle_graph, bundle)?;
    let externals = write_external_imports(&mut printer, bundle_graph, bundle)?;
    write_bundle_references(&mut printer, bundle_graph, bundle)?;

    printer.write_var(
      runtime_name(should_optimize, "modules", RUNTIME_MODULES),
      "{",
      false,
    )?;

    let mut first: bool = true;
    let mut synthetic_assets = IndexSet::new();

    for asset_index in &bundle.assets {
      let asset = &bundle_graph.asset_graph.asset(*asset_index);
      if !first {
        printer.write_char(',')?;
      }
      first = false;

      write_asset_module(
        &mut printer,
        *asset_index,
        asset,
        bundle_graph,
        bundle,
        &mut synthetic_assets,
        get_inline_bundle_content,
        options,
        should_build_source_map,
        should_optimize,
      )?;
    }

    let rsc_server_entry =
      if let Some(module) = rsc::server_entry(bundle, bundle_graph, &options.project_root)? {
        let id = module.id();
        synthetic_assets.insert(SyntheticAsset::Rsc(module));
        Some(id)
      } else {
        None
      };

    for synthetic_asset in synthetic_assets {
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
      &options.project_root,
      should_optimize,
    )?;

    printer.write_str(if should_optimize {
      RUNTIME
    } else {
      DEV_RUNTIME
    })?;
    printer.into_content()
  }
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
        externals.insert(dependency.specifier.clone());
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

/// Writes imports for bundles referenced by this one, so they load first.
fn write_bundle_references(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Result<(), DiagnosticList> {
  for b in &bundle.referenced_bundles {
    let referenced = &bundle_graph.bundles[*b];
    if referenced.ty != AssetType::Js {
      continue;
    }

    let specifier = referenced.relative_specifier(bundle).unwrap();
    if bundle.target.output_format == OutputFormat::Commonjs {
      write!(printer, "require({});", serde_json::to_string(&specifier)?)?;
    } else {
      write!(printer, "import {};", serde_json::to_string(&specifier)?)?;
    }
    printer.newline()?;
  }

  Ok(())
}

fn write_asset_module(
  printer: &mut Printer,
  asset_index: AssetIndex,
  asset: &Asset,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  synthetic_assets: &mut IndexSet<SyntheticAsset>,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  options: &ParcelOptions,
  should_build_source_map: bool,
  should_optimize: bool,
) -> Result<(), DiagnosticList> {
  let dependencies = asset_dependencies(
    asset_index,
    asset,
    bundle_graph,
    Some(bundle),
    synthetic_assets,
    get_inline_bundle_content,
    &options.project_root,
  )?;

  if let Some(content) = asset.content.downcast_ref::<JsContent>() {
    let mut ast = content.ast.clone();
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
    let (code, map) = ast.to_code(should_build_source_map, should_optimize)?;

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
) -> Result<(), DiagnosticList> {
  if !bundle.assets.iter().any(|asset_index| {
    bundle_graph
      .asset_graph
      .asset(*asset_index)
      .flags
      .contains(AssetFlags::HAS_NODE_REPLACEMENTS)
  }) {
    return Ok(());
  }

  let should_optimize = bundle
    .target
    .flags
    .contains(EnvironmentFlags::SHOULD_OPTIMIZE);
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
    let (filename, dirname) = node_replacement_paths(asset, bundle);
    let mut items = Vec::with_capacity(2);

    if content.needs_filename {
      let name = Ident::new("__filename".into(), DUMMY_SP, ctxt);
      items.push(quote!(
        "var $name = $path.resolve($bundle_dir, $value)" as ModuleItem,
        name: Ident = name,
        path: Ident = path.clone(),
        bundle_dir: Ident = bundle_dir.clone(),
        value: Expr = filename.into()
      ));
    }

    if content.needs_dirname {
      let name = Ident::new("__dirname".into(), DUMMY_SP, ctxt);
      items.push(quote!(
        "var $name = $path.resolve($bundle_dir, $value)" as ModuleItem,
        name: Ident = name,
        path: Ident = path,
        bundle_dir: Ident = bundle_dir,
        value: Expr = dirname.into()
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

fn node_replacement_paths(asset: &Asset, bundle: &Bundle) -> (String, String) {
  let bundle_dir = bundle
    .dist_path()
    .parent()
    .unwrap_or(bundle.target.dist_dir);
  let from = SourceUrl::from_directory_path(&bundle_dir);

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
  if should_optimize {
    write!(printer, "'{}':function(module,exports){{", id)?;
  } else {
    printer.write_module_header(id)?;
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
  if !should_optimize {
    printer.write_module_trailer(deps)?;
  } else {
    printer.write_char('}')?;
  }

  Ok(())
}

fn write_runtime_globals(
  printer: &mut Printer,
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
  rsc_server_entry: Option<String>,
  externals: &IndexSet<String>,
  project_root: &PathId,
  should_optimize: bool,
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

  printer.write_var(
    runtime_name(should_optimize, "entries", RUNTIME_ENTRIES),
    "[",
    false,
  )?;
  if let Some(entry) = rsc_server_entry {
    write!(printer, "'{}',", entry)?;
  }
  for entry in &bundle.entry_assets {
    let asset = &bundle_graph.asset_graph.asset(*entry);
    write!(printer, "'{}'", asset.id(project_root))?;
  }

  printer.write_str("];")?;
  printer.newline()?;

  let runtime_main_entry = runtime_name(should_optimize, "mainEntry", RUNTIME_MAIN_ENTRY);
  if let Some(main) = &bundle.main_entry_asset {
    let asset = &bundle_graph.asset_graph.asset(*main);
    printer.write_var(
      runtime_main_entry,
      &format!("'{}'", asset.id(project_root)),
      true,
    )?;
  } else {
    printer.write_var(runtime_main_entry, "null", true)?;
  }

  Ok(())
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
