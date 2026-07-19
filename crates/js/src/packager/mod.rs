use std::{fmt::Write, sync::Arc};

use indexmap::IndexSet;
use parcel_core::*;
use parcel_js_swc_core::tree_shake::tree_shake;

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
      let asset = bundle_graph.asset_graph.assets[bundle.main_entry_asset.unwrap()].expect_asset();
      if bundle.target.source_map.is_some()
        && let Some(content) = asset.content.downcast_ref::<JsContent>()
      {
        let (code, map) = content.ast.to_code(true, false)?;
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
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[main] {
        if let Some(content) = asset.content.downcast_ref::<JsContent>() {
          if let Some(shebang) = &content.shebang {
            write!(printer, "#!{}\n", shebang)?;
          }
        }
      }
    }

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
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[*asset_index] {
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
    let asset = bundle_graph.asset_graph.assets[*asset_index].expect_asset();
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
  asset_index: usize,
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

  if should_optimize && let Some(content) = asset.content.downcast_ref::<JsContent>() {
    let mut ast = content.ast.clone();
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
      .relative(&SourceUrl::from_directory_path(&bundle.target.dist_dir))
      .unwrap_or_else(|| asset.loc.url.to_string())
      .into();
    tree_shake(
      &mut ast,
      used_symbols,
      dependencies,
      dirname,
      true,
      false,
      RUNTIME_REQUIRE.into(),
    );
    ast.finalize();
    let (code, map) = ast.to_code(should_build_source_map, true)?;

    printer.write_module_header(asset.id(&options.project_root))?;
    printer.add_source_map(map)?;
    printer.write_expression_code(&code)?;
  } else {
    let (code, map) = if should_build_source_map {
      if let Some(content) = asset.content.downcast_ref::<JsContent>() {
        content.ast.to_code(true, false)?
      } else {
        (asset.content.read()?, None)
      }
    } else {
      (asset.content.read()?, None)
    };
    let deps = serde_json::to_string(&dependencies)?;

    printer.write_module_header(asset.id(&options.project_root))?;
    printer.add_source_map(map)?;
    printer.write_str(std::str::from_utf8(&code).unwrap())?;
    printer.write_module_trailer(deps)?;
  }

  Ok(())
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
    let asset = &bundle_graph.asset_graph.assets[*entry].expect_asset();
    write!(printer, "'{}'", asset.id(project_root))?;
  }

  printer.write_str("];")?;
  printer.newline()?;

  let runtime_main_entry = runtime_name(should_optimize, "mainEntry", RUNTIME_MAIN_ENTRY);
  if let Some(main) = &bundle.main_entry_asset {
    let asset = &bundle_graph.asset_graph.assets[*main].expect_asset();
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
