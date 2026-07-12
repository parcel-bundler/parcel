use std::{
  borrow::Cow,
  fmt::{self, Write},
  sync::Arc,
};

use indexmap::{IndexMap, IndexSet};
use parcel_core::*;
use parcel_js_swc_core::tree_shake::tree_shake;
use serde::Serialize;
use serde_json::value::RawValue;

use parcel_css::resolve_css_module_export;

pub use parcel_js_swc_core::tree_shake::Resolution;

use crate::JsContent;

const RUNTIME_MODULES: &str = "m";
const RUNTIME_PARCEL_REQUIRE_NAME: &str = "p";
const RUNTIME_EXTERNALS: &str = "x";
const RUNTIME_ENTRIES: &str = "e";
const RUNTIME_MAIN_ENTRY: &str = "n";
const RUNTIME_REQUIRE: &str = "r";

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
    const DEV_RUNTIME: &str = include_str!("dev-runtime.js");

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

    let runtime_modules = runtime_name(should_optimize, "modules", RUNTIME_MODULES);
    let runtime_parcel_require_name = runtime_name(
      should_optimize,
      "parcelRequireName",
      RUNTIME_PARCEL_REQUIRE_NAME,
    );
    let runtime_externals = runtime_name(should_optimize, "externals", RUNTIME_EXTERNALS);
    let runtime_entries = runtime_name(should_optimize, "entries", RUNTIME_ENTRIES);
    let runtime_main_entry = runtime_name(should_optimize, "mainEntry", RUNTIME_MAIN_ENTRY);

    printer.write_var(runtime_modules, "{", false)?;

    let mut first: bool = true;
    let mut synthetic_assets = IndexSet::new();

    for asset_index in &bundle.assets {
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[*asset_index] {
        let dependencies = asset_dependencies(
          *asset_index,
          asset,
          bundle_graph,
          Some(bundle),
          &mut synthetic_assets,
          get_inline_bundle_content,
          &options.project_root,
        )?;

        if !first {
          printer.write_char(',')?;
        }
        first = false;

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
      }
    }

    let rsc_server_entry = if bundle.flags.contains(BundleFlags::ENTRY)
      && bundle.target.environment == Environment::ReactServer
      && let Some(entry) = bundle.main_entry_asset
    {
      let asset = bundle_graph.asset_graph.assets[entry].expect_asset();
      let synthetic = SyntheticAsset::RscServerEntry {
        entry: entry as u32,
        runtime: rsc_runtime_asset(entry, asset, bundle_graph)?,
        actions: server_actions(bundle_graph, &options.project_root),
      };
      let id = synthetic.id();
      synthetic_assets.insert(synthetic);
      Some(id)
    } else {
      None
    };

    for synthetic_asset in synthetic_assets {
      if !first {
        printer.write_char(',')?;
      }
      first = false;

      if should_optimize {
        write!(
          printer,
          "'{}':function(module,exports){{",
          synthetic_asset.id()
        )?;
      } else {
        printer.write_module_header(synthetic_asset.id())?;
      }
      synthetic_asset.write_content(
        &mut printer,
        should_optimize,
        bundle_graph,
        bundle,
        get_inline_bundle_content,
        &options.project_root,
      )?;
      let deps =
        serde_json::to_string(&synthetic_asset.dependencies(bundle_graph, &options.project_root))?;
      if !should_optimize {
        printer.write_module_trailer(deps)?;
      } else {
        printer.write_char('}')?;
      }
    }

    printer.write_str("};")?;
    printer.newline()?;
    printer.newline()?;
    printer.write_var(runtime_parcel_require_name, "'parcelRequire'", true)?;
    printer.write_var(runtime_externals, "{}", true)?;
    printer.write_var(runtime_entries, "[", false)?;
    if let Some(entry) = rsc_server_entry {
      write!(printer, "'{}',", entry)?;
    }
    for entry in &bundle.entry_assets {
      let asset = &bundle_graph.asset_graph.assets[*entry].expect_asset();
      write!(printer, "'{}'", asset.id(&options.project_root))?;
    }

    printer.write_str("];")?;
    printer.newline()?;
    if let Some(main) = &bundle.main_entry_asset {
      let asset = &bundle_graph.asset_graph.assets[*main].expect_asset();
      printer.write_var(
        runtime_main_entry,
        &format!("'{}'", asset.id(&options.project_root)),
        true,
      )?;
    } else {
      printer.write_var(runtime_main_entry, "null", true)?;
    }

    printer.write_str(
      if bundle
        .target
        .flags
        .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
      {
        RUNTIME
      } else {
        DEV_RUNTIME
      },
    )?;

    let (res, source_map_sections) = printer.into_parts();

    if let Some(source_map_sections) = source_map_sections
      && !source_map_sections.is_empty()
    {
      let map = serde_json::to_vec(&SourceMapIndex {
        version: 3,
        sections: source_map_sections,
      })?;
      Ok(Arc::new(ContentWithSourceMap::new(res.into_bytes(), map)))
    } else {
      Ok(Arc::new(BufferContent::new(res.into_bytes())))
    }
  }
}

struct Printer {
  output: String,
  line: u32,
  column: u32,
  source_map_sections: Option<Vec<SourceMapSection>>,
  should_optimize: bool,
}

impl Printer {
  fn new(source_maps: bool, should_optimize: bool) -> Self {
    Printer {
      output: String::new(),
      line: 0,
      column: 0,
      source_map_sections: source_maps.then(Vec::new),
      should_optimize,
    }
  }

  fn add_source_map(&mut self, map: Option<String>) -> Result<(), DiagnosticList> {
    if let Some(source_map_sections) = &mut self.source_map_sections
      && let Some(map) = map
    {
      source_map_sections.push(SourceMapSection::new(self.line, self.column, map)?);
    }

    Ok(())
  }

  #[inline]
  fn write_module_header(&mut self, id: String) -> std::fmt::Result {
    if self.should_optimize {
      write!(self, "'{}':", id)
    } else {
      writeln!(self, "'{}':[function(module,exports,require) {{", id)
    }
  }

  #[inline]
  fn write_module_trailer(&mut self, deps: String) -> std::fmt::Result {
    write!(self, "\n}}, {}]", deps)
  }

  #[inline]
  fn write_expression_code(&mut self, code: &[u8]) -> std::io::Result<()> {
    let mut end = code.len();
    while end > 0 && code[end - 1].is_ascii_whitespace() {
      end -= 1;
    }

    if end > 0 && code[end - 1] == b';' {
      std::io::Write::write_all(self, &code[..end - 1])?;
      std::io::Write::write_all(self, &code[end..])
    } else {
      std::io::Write::write_all(self, code)
    }
  }

  #[inline]
  fn newline(&mut self) -> std::fmt::Result {
    if !self.should_optimize {
      writeln!(self)
    } else {
      Ok(())
    }
  }

  #[inline]
  fn write_var(&mut self, name: &str, value: &str, semi: bool) -> std::fmt::Result {
    if self.should_optimize {
      write!(self, "var {name}={value}")?;
    } else {
      write!(self, "var {name} = {value}")?;
    }
    if semi {
      self.write_char(';')?;
    }
    self.newline()
  }

  fn into_parts(self) -> (String, Option<Vec<SourceMapSection>>) {
    (self.output, self.source_map_sections)
  }
}

impl std::fmt::Write for Printer {
  fn write_str(&mut self, s: &str) -> fmt::Result {
    if self.source_map_sections.is_some() {
      update_position(s, &mut self.line, &mut self.column);
    }
    self.output.push_str(s);
    Ok(())
  }
}

impl std::io::Write for Printer {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    let s = std::str::from_utf8(buf).map_err(std::io::Error::other)?;
    if self.source_map_sections.is_some() {
      update_position(s, &mut self.line, &mut self.column);
    }
    self.output.push_str(s);
    Ok(buf.len())
  }

  fn flush(&mut self) -> std::io::Result<()> {
    Ok(())
  }
}

fn update_position(s: &str, line: &mut u32, column: &mut u32) {
  for segment in s.split_inclusive('\n') {
    if segment.ends_with('\n') {
      *line += 1;
      *column = 0;
    } else {
      *column += segment.len() as u32;
    }
  }
}

#[derive(Serialize)]
struct SourceMapIndex {
  version: u8,
  sections: Vec<SourceMapSection>,
}

#[derive(Serialize)]
struct SourceMapSection {
  offset: SourceMapSectionOffset,
  map: Box<RawValue>,
}

impl SourceMapSection {
  fn new(line: u32, column: u32, map: String) -> Result<Self, DiagnosticList> {
    Ok(SourceMapSection {
      offset: SourceMapSectionOffset { line, column },
      map: RawValue::from_string(map)?,
    })
  }
}

#[derive(Serialize)]
struct SourceMapSectionOffset {
  line: u32,
  column: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RscServerAction {
  asset_index: u32,
  bundles: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum RscResourceKind {
  Stylesheet,
  ModulePreload,
  ScriptPreload,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct RscResource {
  kind: RscResourceKind,
  url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RscResourcePlan {
  original_asset: u32,
  resources: Vec<RscResource>,
  load_bundles: Vec<u32>,
  client_css: Vec<String>,
  client_entry: Option<u32>,
  bootstrap_modules: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum SyntheticAsset {
  Asset(String, u32),
  Async(u32),
  AsyncInterop(u32),
  Url(u32),
  Inline(u32),
  RscEmpty {
    importer: u32,
    dependency: u32,
  },
  RscClientReference {
    importer: u32,
    dependency: u32,
    runtime: u32,
    exports: Vec<(SymbolName, SymbolResolution)>,
    bundles: Vec<String>,
    bundle: u32,
    is_async: bool,
  },
  RscServerReference {
    importer: u32,
    dependency: u32,
    runtime: u32,
    original: u32,
    exports: Vec<(SymbolName, SymbolResolution)>,
    is_client: bool,
    is_async: bool,
  },
  RscResources {
    importer: u32,
    dependency: u32,
    runtime: u32,
    bundle: u32,
    plan: RscResourcePlan,
    is_async: bool,
  },
  RscServerEntry {
    entry: u32,
    runtime: u32,
    actions: Vec<RscServerAction>,
  },
}

fn is_inline_bundle_dependency(dependency: &Dependency, bundle: &Bundle) -> bool {
  dependency.bundle_behavior == BundleBehavior::Inline
    || bundle.bundle_behavior == BundleBehavior::Inline
}

fn is_async_bundle_dependency(dependency: &Dependency, bundle: &Bundle) -> bool {
  dependency.priority == Priority::Lazy
    && dependency.specifier_type != SpecifierType::Url
    && !is_inline_bundle_dependency(dependency, bundle)
}

pub fn asset_dependencies<'a>(
  asset_index: usize,
  asset: &'a Asset,
  bundle_graph: &'a BundleGraph,
  bundle: Option<&'a Bundle>,
  additional_assets: &mut IndexSet<SyntheticAsset>,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  project_root: &PathId,
) -> Result<IndexMap<String, Resolution<'a>>, DiagnosticList> {
  let mut dependencies = IndexMap::new();

  let used_deps: Vec<u32> = asset.resolved_dependencies().collect();

  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    let placeholder = dep.placeholder.as_ref().unwrap_or(&dep.specifier);
    let graph_resolution = bundle_graph.dependency_resolution(asset_index, dep_index);
    let resolved = match graph_resolution {
      BundleGraphDependencyResolution::Asset(asset_index) => Some((asset_index, None)),
      BundleGraphDependencyResolution::Bundle(bundle_index) => bundle_graph.bundles
        [bundle_index as usize]
        .main_entry_asset
        .map(|asset_index| (asset_index as u32, Some(bundle_index))),
      _ => None,
    };

    if let Some((resolved_asset, bundle_index)) = resolved
      && let Some(synthetic) = rsc_dependency_resolution(
        asset_index,
        dep_index,
        asset,
        dep,
        resolved_asset,
        bundle_index,
        bundle_graph,
      )?
    {
      let id = synthetic.id();
      additional_assets.insert(synthetic);
      dependencies.insert(placeholder.as_str().into(), Resolution::Asset(id));
      continue;
    }

    match graph_resolution {
      BundleGraphDependencyResolution::Asset(resolved) => {
        if let AssetNode::Asset(resolved_asset) =
          &bundle_graph.asset_graph.assets[resolved as usize]
        {
          if resolved_asset.ty != AssetType::Js {
            if resolved_asset.symbols.exports.iter().any(|e| e.requested) {
              let asset = &bundle_graph.asset_graph.assets[resolved as usize].expect_asset();
              let id = asset.id(project_root);
              dependencies.insert(placeholder.as_str().into(), Resolution::Asset(id.clone()));
              additional_assets.insert(SyntheticAsset::Asset(id, resolved));
              continue;
            }
            dependencies.insert(placeholder.as_str().into(), Resolution::Excluded);
            continue;
          }
        }

        let mut resolutions = Vec::new();
        let mut first_asset = None;
        let mut all_assets_match = true;
        if !asset.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          for import in &asset.symbols.imports {
            if import.dep_index == dep_index as u32 {
              match &import.resolved {
                SymbolResolution::Export {
                  asset_index,
                  export_index,
                } => {
                  let asset = bundle_graph.asset_graph.assets[*asset_index as usize].expect_asset();
                  let export = &asset.symbols.exports[*export_index as usize];
                  resolutions.push((
                    import.symbol.as_str(),
                    asset.id(project_root),
                    export.exported.as_str(),
                  ));
                  if first_asset.is_none() {
                    first_asset = Some(*asset_index);
                  }
                  if first_asset != Some(*asset_index) || import.symbol != export.exported {
                    all_assets_match = false;
                  }
                }
                SymbolResolution::Runtime { asset_index, name } => {
                  let asset =
                    &bundle_graph.asset_graph.assets[*asset_index as usize].expect_asset();
                  resolutions.push((
                    import.symbol.as_str(),
                    asset.id(project_root),
                    name.as_str(),
                  ));
                  if first_asset.is_none() {
                    first_asset = Some(*asset_index);
                  }
                  if first_asset != Some(*asset_index) {
                    all_assets_match = false;
                  }
                }
                SymbolResolution::Namespace { asset_index } => {
                  let asset =
                    &bundle_graph.asset_graph.assets[*asset_index as usize].expect_asset();
                  resolutions.push((import.symbol.as_str(), asset.id(project_root), "*"));
                  if first_asset.is_none() {
                    first_asset = Some(*asset_index);
                  }
                  if first_asset != Some(*asset_index) || import.symbol != SymbolName::Namespace {
                    all_assets_match = false;
                  }
                }
                _ => continue,
              }
            }
          }
        }

        // TODO: add indirect/star exports

        if !resolutions.is_empty() {
          if all_assets_match && let Some(res) = first_asset {
            let asset = &bundle_graph.asset_graph.assets[res as usize].expect_asset();
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::Asset(asset.id(project_root)),
            );
          } else {
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::Symbols(resolutions),
            );
          }
        } else if matches!(
          bundle_graph.asset_graph.assets[resolved as usize],
          AssetNode::Deferred { .. }
        ) || !used_deps.contains(&resolved)
        {
          dependencies.insert(placeholder.as_str().into(), Resolution::Excluded);
        } else {
          let asset = &bundle_graph.asset_graph.assets[resolved as usize].expect_asset();
          dependencies.insert(
            placeholder.as_str().into(),
            Resolution::Asset(asset.id(project_root)),
          );
        }
      }
      BundleGraphDependencyResolution::None | BundleGraphDependencyResolution::Excluded => {}
      BundleGraphDependencyResolution::Deferred => {
        dependencies.insert(placeholder.as_str().into(), Resolution::Excluded);
      }
      BundleGraphDependencyResolution::External => {
        if dep.specifier_type == SpecifierType::Url {
          dependencies.insert(placeholder.as_str().into(), Resolution::Unresolved);
        } else {
          dependencies.insert(
            placeholder.as_str().into(),
            Resolution::External(Cow::Borrowed(&dep.specifier)),
          );
        }
      }
      BundleGraphDependencyResolution::Bundle(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[bundle_index as usize];

        if asset.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          let bundle = bundle.expect("Bundle must be provided for library builds");
          if dep.bundle_behavior == BundleBehavior::Inline
            || resolved_bundle.bundle_behavior == BundleBehavior::Inline
          {
            let content = get_inline_bundle_content(bundle_index as usize)
              .unwrap()
              .read()?;
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::String(String::from_utf8(content)?),
            );
          } else if dep.specifier_type == SpecifierType::Url {
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::String(resolved_bundle.relative_url(bundle).unwrap().into()),
            );
          } else {
            if resolved_bundle.ty != AssetType::Js
              && let Some(main) = resolved_bundle.main_entry_asset
            {
              if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[main] {
                let mut exports = Vec::new();
                for exp in &asset.symbols.exports {
                  if !exp.requested {
                    continue;
                  }

                  if let Some(value) = resolve_css_module_export(
                    &bundle_graph.asset_graph.assets,
                    main,
                    exp.exported.as_str(),
                  ) {
                    exports.push((exp.exported.as_str(), value));
                  }
                }

                if !exports.is_empty() {
                  dependencies.insert(
                    placeholder.as_str().into(),
                    Resolution::CssModule(
                      resolved_bundle.relative_specifier(bundle).unwrap(),
                      exports,
                    ),
                  );
                  continue;
                }
              }
            }
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::External(resolved_bundle.relative_specifier(bundle).unwrap().into()),
            );
          }
        } else {
          let is_lazy_dynamic_import = is_async_bundle_dependency(dep, resolved_bundle);
          let is_inline = is_inline_bundle_dependency(dep, resolved_bundle);
          // TODO: this is wrong. It should be if the _target_ module is CJS. But this breaks some dynamic_import tests. Would be a behavior change.
          let needs_esm_interop =
            is_lazy_dynamic_import && !is_inline && asset.flags.contains(AssetFlags::IS_ESM);

          if is_inline {
            additional_assets.insert(SyntheticAsset::Inline(bundle_index));
          } else if is_lazy_dynamic_import {
            additional_assets.insert(SyntheticAsset::Async(bundle_index));
            if needs_esm_interop {
              additional_assets.insert(SyntheticAsset::AsyncInterop(bundle_index));
            }
          } else {
            additional_assets.insert(SyntheticAsset::Url(bundle_index));
          };

          let resolution = if needs_esm_interop {
            Resolution::BundleInterop(bundle_index)
          } else {
            Resolution::Bundle(bundle_index)
          };
          dependencies.insert(placeholder.as_str().into(), resolution);
        }
      }
    }
  }

  Ok(dependencies)
}

fn rsc_dependency_resolution(
  importer_index: usize,
  dependency_index: usize,
  importer: &Asset,
  dependency: &Dependency,
  resolved_index: u32,
  bundle_index: Option<u32>,
  bundle_graph: &BundleGraph,
) -> Result<Option<SyntheticAsset>, DiagnosticList> {
  if importer.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
    || !matches!(
      importer.target.environment,
      Environment::ReactServer | Environment::ReactClient
    )
  {
    return Ok(None);
  }

  let AssetNode::Asset(resolved) = &bundle_graph.asset_graph.assets[resolved_index as usize] else {
    return Ok(None);
  };
  let directives = resolved
    .content
    .downcast_ref::<JsContent>()
    .map(|content| content.directives.as_slice())
    .unwrap_or_default();

  if importer.target.environment == Environment::ReactServer
    && directives
      .iter()
      .any(|directive| directive == "use client-entry")
  {
    return Ok(Some(SyntheticAsset::RscEmpty {
      importer: importer_index as u32,
      dependency: dependency_index as u32,
    }));
  }

  if importer.target.environment == Environment::ReactServer
    && resolved.target.environment == Environment::ReactClient
    && directives.iter().any(|directive| directive == "use client")
  {
    let bundle_index = bundle_index
      .or_else(|| {
        bundle_graph
          .bundles
          .iter()
          .position(|bundle| bundle.assets.contains(&(resolved_index as usize)))
          .map(|bundle_index| bundle_index as u32)
      })
      .ok_or_else(|| {
        DiagnosticList::from(Diagnostic::from_message(
          "React client reference asset was not included in a bundle".into(),
        ))
      })?;
    let runtime = rsc_runtime_asset(importer_index, importer, bundle_graph)?;
    return Ok(Some(SyntheticAsset::RscClientReference {
      importer: importer_index as u32,
      dependency: dependency_index as u32,
      runtime,
      exports: bundle_graph
        .asset_graph
        .get_exports(resolved_index, importer.target.environment),
      bundles: client_bundle_names(bundle_graph, bundle_index),
      bundle: bundle_index,
      is_async: dependency.priority == Priority::Lazy,
    }));
  }

  if directives.iter().any(|directive| directive == "use server") {
    let runtime = rsc_runtime_asset(importer_index, importer, bundle_graph)?;
    return Ok(Some(SyntheticAsset::RscServerReference {
      importer: importer_index as u32,
      dependency: dependency_index as u32,
      runtime,
      original: resolved_index,
      exports: if importer.target.environment == Environment::ReactClient {
        bundle_graph
          .asset_graph
          .get_exports(resolved_index, importer.target.environment)
      } else {
        Vec::new()
      },
      is_client: importer.target.environment == Environment::ReactClient,
      is_async: dependency.priority == Priority::Lazy,
    }));
  }

  if let Some(bundle_index) = bundle_index {
    let target_bundle = &bundle_graph.bundles[bundle_index as usize];
    if dependency.specifier_type == SpecifierType::Url
      || is_inline_bundle_dependency(dependency, target_bundle)
    {
      return Ok(None);
    }

    let plan = rsc_resource_plan(importer, resolved_index, bundle_index, bundle_graph);
    let should_proxy = is_async_bundle_dependency(dependency, target_bundle)
      || !plan.resources.is_empty()
      || (dependency.priority != Priority::Lazy && plan.client_entry.is_some());
    if !should_proxy {
      return Ok(None);
    }

    let runtime = rsc_runtime_asset(importer_index, importer, bundle_graph)?;
    return Ok(Some(SyntheticAsset::RscResources {
      importer: importer_index as u32,
      dependency: dependency_index as u32,
      runtime,
      bundle: bundle_index,
      plan,
      is_async: dependency.priority == Priority::Lazy,
    }));
  }

  Ok(None)
}

fn rsc_resource_plan(
  importer: &Asset,
  original_asset: u32,
  bundle_index: u32,
  bundle_graph: &BundleGraph,
) -> RscResourcePlan {
  let mut plan = RscResourcePlan {
    original_asset,
    resources: Vec::new(),
    load_bundles: Vec::new(),
    client_css: Vec::new(),
    client_entry: None,
    bootstrap_modules: Vec::new(),
  };

  for bundle_index in bundle_graph.referenced_bundles(bundle_index as usize) {
    let bundle = &bundle_graph.bundles[bundle_index];
    if bundle.ty == AssetType::Css {
      let url = bundle.absolute_url();
      plan.resources.push(RscResource {
        kind: RscResourceKind::Stylesheet,
        url: url.clone(),
      });
      if importer.target.environment == Environment::ReactClient {
        plan.client_css.push(url);
      }
    } else if bundle.ty == AssetType::Js {
      if bundle.target.environment == importer.target.environment {
        plan.load_bundles.push(bundle_index as u32);
      }
      if bundle.target.environment == Environment::ReactClient {
        let url = bundle.absolute_url();
        plan.bootstrap_modules.push(url.clone());
        if importer.target.environment == Environment::ReactClient {
          plan.resources.push(RscResource {
            kind: if bundle.target.output_format == OutputFormat::Esmodule {
              RscResourceKind::ModulePreload
            } else {
              RscResourceKind::ScriptPreload
            },
            url,
          });
        }
      }
    }

    if plan.client_entry.is_none() {
      plan.client_entry = bundle.assets.iter().find_map(|asset_index| {
        let asset = bundle_graph.asset_graph.assets[*asset_index].expect_asset();
        asset
          .content
          .downcast_ref::<JsContent>()
          .is_some_and(|content| {
            content
              .directives
              .iter()
              .any(|directive| directive == "use client-entry")
          })
          .then_some(*asset_index as u32)
      });
    }
  }

  plan
}

fn rsc_runtime_asset(
  importer_index: usize,
  importer: &Asset,
  bundle_graph: &BundleGraph,
) -> Result<u32, DiagnosticList> {
  let resolution = importer
    .content
    .downcast_ref::<JsContent>()
    .and_then(|content| content.rsc_runtime_dep)
    .map(|dependency_index| {
      bundle_graph.dependency_resolution(importer_index, dependency_index as usize)
    })
    .unwrap_or(BundleGraphDependencyResolution::None);

  match resolution {
    BundleGraphDependencyResolution::Asset(asset_index) => Ok(asset_index),
    BundleGraphDependencyResolution::Bundle(bundle_index) => bundle_graph.bundles
      [bundle_index as usize]
      .main_entry_asset
      .map(|asset_index| asset_index as u32)
      .ok_or_else(|| {
        Diagnostic::from_message("RSC support bundle does not have a main entry asset".into())
          .into()
      }),
    _ => Err(Diagnostic::from_message("Could not resolve RSC runtime asset".into()).into()),
  }
}

fn client_bundle_names(bundle_graph: &BundleGraph, bundle_index: u32) -> Vec<String> {
  bundle_graph
    .referenced_bundles(bundle_index as usize)
    .filter_map(|bundle_index| {
      let bundle = &bundle_graph.bundles[bundle_index];
      (bundle.ty == AssetType::Js && bundle.target.environment == Environment::ReactClient)
        .then(|| bundle.name())
    })
    .collect()
}

fn server_actions(bundle_graph: &BundleGraph, project_root: &PathId) -> Vec<RscServerAction> {
  let mut actions: IndexMap<String, RscServerAction> = IndexMap::new();
  for (asset_index, node) in bundle_graph.asset_graph.assets.iter().enumerate() {
    let AssetNode::Asset(asset) = node else {
      continue;
    };
    let is_server_action = asset
      .content
      .downcast_ref::<JsContent>()
      .is_some_and(|content| {
        content
          .directives
          .iter()
          .any(|directive| directive == "use server")
      });
    if !is_server_action {
      continue;
    }

    let Some(bundle_index) = bundle_graph
      .bundles
      .iter()
      .position(|bundle| bundle.assets.contains(&asset_index))
    else {
      continue;
    };
    let names = bundle_graph
      .referenced_bundles(bundle_index)
      .filter_map(|bundle_index| {
        let bundle = &bundle_graph.bundles[bundle_index];
        (bundle.ty == AssetType::Js && bundle.target.environment == Environment::ReactServer)
          .then(|| bundle.name())
      })
      .collect::<Vec<_>>();
    let id = asset.id(project_root);
    if let Some(action) = actions.get_mut(&id) {
      for name in names {
        if !action.bundles.contains(&name) {
          action.bundles.push(name);
        }
      }
    } else {
      actions.insert(
        id,
        RscServerAction {
          asset_index: asset_index as u32,
          bundles: names,
        },
      );
    }
  }
  actions.into_values().collect()
}

impl SyntheticAsset {
  pub fn id(&self) -> String {
    match self {
      SyntheticAsset::Asset(id, _) => id.clone(),
      SyntheticAsset::Async(id) => format!("b{}", id),
      SyntheticAsset::AsyncInterop(id) => format!("b{}i", id),
      SyntheticAsset::Url(id) => format!("b{}", id),
      SyntheticAsset::Inline(id) => format!("b{}", id),
      SyntheticAsset::RscEmpty {
        importer,
        dependency,
      } => format!("rsc_e_{}_{}", importer, dependency),
      SyntheticAsset::RscClientReference {
        importer,
        dependency,
        ..
      } => format!("rsc_c_{}_{}", importer, dependency),
      SyntheticAsset::RscServerReference {
        importer,
        dependency,
        is_client,
        ..
      } => format!(
        "rsc_s{}_{}_{}",
        if *is_client { "c" } else { "s" },
        importer,
        dependency
      ),
      SyntheticAsset::RscResources {
        importer,
        dependency,
        ..
      } => format!("rsc_r_{}_{}", importer, dependency),
      SyntheticAsset::RscServerEntry { entry, .. } => format!("rsc_entry_{}", entry),
    }
  }

  pub fn dependencies<'a>(
    &self,
    bundle_graph: &'a BundleGraph,
    project_root: &PathId,
  ) -> IndexMap<String, Resolution<'a>> {
    let mut dependencies = IndexMap::new();
    match self {
      SyntheticAsset::Async(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];
        if let Some(main_entry_asset) = resolved_bundle.main_entry_asset {
          let asset = bundle_graph.asset_graph.assets[main_entry_asset].expect_asset();
          dependencies.insert("bundle".into(), Resolution::Asset(asset.id(project_root)));
        }
      }
      SyntheticAsset::AsyncInterop(bundle_index) => {
        dependencies.insert(
          "bundle".into(),
          Resolution::Asset(format!("b{}", bundle_index)),
        );
      }
      SyntheticAsset::RscEmpty { .. }
      | SyntheticAsset::RscClientReference { .. }
      | SyntheticAsset::RscServerReference { .. }
      | SyntheticAsset::RscResources { .. }
      | SyntheticAsset::RscServerEntry { .. } => {}
      _ => {}
    }

    dependencies
  }

  pub fn write_content<W: std::fmt::Write>(
    &self,
    dest: &mut W,
    should_optimize: bool,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    project_root: &PathId,
  ) -> Result<(), DiagnosticList> {
    match self {
      SyntheticAsset::Asset(_id, asset_index) => {
        if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[*asset_index as usize] {
          for exp in &asset.symbols.exports {
            if !exp.requested {
              continue;
            }

            if let Some(value) = resolve_css_module_export(
              &bundle_graph.asset_graph.assets,
              *asset_index as usize,
              exp.exported.as_str(),
            ) {
              write!(dest, "exports[{:?}]='{}';\n", exp.exported.as_str(), value)?;
            }
          }
        }
      }
      SyntheticAsset::Async(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];
        // if matches!(
        //   bundle.env.context,
        //   EnvironmentContext::ReactServer | EnvironmentContext::ReactClient
        // ) {
        //   load_bundles_rsc(bundle_graph, resolved_bundle, dest)?;
        // } else {
        load_bundles(
          bundle_graph,
          bundle,
          resolved_bundle,
          dest,
          project_root,
          runtime_name(should_optimize, "require", RUNTIME_REQUIRE),
        )?;
        // }
      }
      SyntheticAsset::AsyncInterop(bundle_index) => {
        write!(
          dest,
          "module.exports={}(\"b{}\").then(m=>m&&m.__esModule?m:{{default:m}})",
          runtime_name(should_optimize, "require", RUNTIME_REQUIRE),
          bundle_index,
        )?;
      }
      SyntheticAsset::Inline(bundle_index) => {
        let content = get_inline_bundle_content(*bundle_index as usize)?.read()?;
        write!(
          dest,
          "module.exports={:?}",
          String::from_utf8_lossy(&content)
        )?;
      }
      SyntheticAsset::Url(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];
        write!(
          dest,
          "module.exports=''+new URL({:?},import.meta.url)",
          resolved_bundle.relative_url(&bundle).unwrap()
        )?;
      }
      SyntheticAsset::RscEmpty { .. } => {}
      SyntheticAsset::RscClientReference {
        runtime,
        exports,
        bundles,
        bundle,
        is_async,
        ..
      } => {
        let require = runtime_name(should_optimize, "require", RUNTIME_REQUIRE);
        let runtime_asset = bundle_graph.asset_graph.assets[*runtime as usize].expect_asset();
        write!(
          dest,
          "let $rsc={}({});\n",
          require,
          serde_json::to_string(&runtime_asset.id(project_root))?
        )?;
        let bundles = serde_json::to_string(bundles)?;
        let resources = if *is_async {
          bundle_graph
            .referenced_bundles(*bundle as usize)
            .filter_map(|bundle_index| {
              let bundle = &bundle_graph.bundles[bundle_index];
              (bundle.ty == AssetType::Css).then(|| bundle.absolute_url())
            })
            .collect::<Vec<_>>()
        } else {
          Vec::new()
        };
        if !resources.is_empty() {
          write!(dest, "let $resources=[")?;
          for resource in &resources {
            write!(
              dest,
              "$rsc.stylesheetResource({}),",
              serde_json::to_string(resource)?
            )?;
          }
          write!(dest, "];\n")?;
        }
        for (export_as, resolution) in exports {
          let Some(asset_index) = resolution.asset_index() else {
            continue;
          };
          let Some(export_name) = resolution.name(&bundle_graph.asset_graph) else {
            continue;
          };
          let referenced_asset =
            bundle_graph.asset_graph.assets[asset_index as usize].expect_asset();
          let export_as = serde_json::to_string(export_as.as_str())?;
          write!(dest, "exports[{}]=", export_as)?;
          if !resources.is_empty() {
            write!(dest, "$rsc.wrapClientReferenceWithResources(")?;
          }
          write!(
            dest,
            "$rsc.createClientReference({},{},{})",
            serde_json::to_string(&referenced_asset.id(project_root))?,
            serde_json::to_string(export_name.as_str())?,
            bundles,
          )?;
          if !resources.is_empty() {
            write!(dest, ",$resources)")?;
          }
          write!(dest, ";\n")?;
        }
        write!(dest, "exports.__esModule=true;\n")?;
        if *is_async {
          write!(dest, "module.exports=Promise.resolve(exports);\n")?;
        }
      }
      SyntheticAsset::RscServerReference {
        runtime,
        original,
        exports: referenced_exports,
        is_client,
        is_async,
        ..
      } => {
        let require = runtime_name(should_optimize, "require", RUNTIME_REQUIRE);
        let runtime_asset = bundle_graph.asset_graph.assets[*runtime as usize].expect_asset();
        write!(
          dest,
          "let $rsc={}({});\n",
          require,
          serde_json::to_string(&runtime_asset.id(project_root))?
        )?;
        if *is_client {
          for (export_as, resolution) in referenced_exports {
            let Some(asset_index) = resolution.asset_index() else {
              continue;
            };
            let Some(export_name) = resolution.name(&bundle_graph.asset_graph) else {
              continue;
            };
            let referenced_asset =
              bundle_graph.asset_graph.assets[asset_index as usize].expect_asset();
            write!(
              dest,
              "exports[{}]=$rsc.createServerReference({},{});\n",
              serde_json::to_string(export_as.as_str())?,
              serde_json::to_string(&referenced_asset.id(project_root))?,
              serde_json::to_string(export_name.as_str())?,
            )?;
          }
        } else {
          let original_asset = bundle_graph.asset_graph.assets[*original as usize].expect_asset();
          let original_id = serde_json::to_string(&original_asset.id(project_root))?;
          write!(dest, "let $original={}({});\n", require, original_id)?;
          write!(dest, "for(let key in $original){{\n")?;
          write!(
            dest,
            "Object.defineProperty(exports,key,{{enumerable:true,get:()=>{{\n"
          )?;
          write!(dest, "let value=$original[key];\n")?;
          write!(
            dest,
            "if(typeof value==='function'&&!value.$$typeof){{$rsc.registerServerReference(value,{},key);}}\n",
            original_id,
          )?;
          write!(dest, "return value;}}}});\n}}\n")?;
        }
        write!(dest, "exports.__esModule=true;\n")?;
        if *is_async {
          write!(dest, "module.exports=Promise.resolve(exports);\n")?;
        }
      }
      SyntheticAsset::RscResources {
        importer,
        dependency,
        runtime,
        bundle: target_bundle_index,
        plan,
        is_async,
      } => {
        let require = runtime_name(should_optimize, "require", RUNTIME_REQUIRE);
        let runtime_asset = bundle_graph.asset_graph.assets[*runtime as usize].expect_asset();
        let importer_asset = bundle_graph.asset_graph.assets[*importer as usize].expect_asset();
        let dependency = &importer_asset.dependencies[*dependency as usize];
        let target_bundle = &bundle_graph.bundles[*target_bundle_index as usize];
        let original_asset =
          bundle_graph.asset_graph.assets[plan.original_asset as usize].expect_asset();
        let original_id = serde_json::to_string(&original_asset.id(project_root))?;

        write!(
          dest,
          "let $rsc={}({});\n",
          require,
          serde_json::to_string(&runtime_asset.id(project_root))?
        )?;

        write!(dest, "let $resources=[")?;
        for resource in &plan.resources {
          let helper = match resource.kind {
            RscResourceKind::Stylesheet => "stylesheetResource",
            RscResourceKind::ModulePreload => "modulePreloadResource",
            RscResourceKind::ScriptPreload => "scriptPreloadResource",
          };
          write!(
            dest,
            "$rsc.{}({}),",
            helper,
            serde_json::to_string(&resource.url)?
          )?;
        }
        write!(dest, "];\n")?;

        let bootstrap_script = plan.client_entry.map(|client_entry| {
          let imports = plan
            .bootstrap_modules
            .iter()
            .map(|url| format!("import({})", serde_json::to_string(url).unwrap()))
            .collect::<Vec<_>>()
            .join(",");
          let entry = bundle_graph.asset_graph.assets[client_entry as usize]
            .expect_asset()
            .id(project_root);
          format!(
            "Promise.all([{}]).then(()=>parcelRequire({}))",
            imports,
            serde_json::to_string(&entry).unwrap()
          )
        });
        if let Some(bootstrap_script) = &bootstrap_script {
          write!(
            dest,
            "let $bootstrapScript={};\n",
            serde_json::to_string(bootstrap_script)?
          )?;
        }

        if *is_async {
          let mut loads = Vec::new();
          let mut css = Vec::new();
          for bundle_index in &plan.load_bundles {
            let load_bundle = &bundle_graph.bundles[*bundle_index as usize];
            let specifier = load_bundle.relative_specifier(bundle).unwrap();
            loads.push(
              if load_bundle.target.output_format == OutputFormat::Commonjs {
                format!(
                  "Promise.resolve({}({}))",
                  require,
                  serde_json::to_string(&specifier)?
                )
              } else {
                format!(
                  "module.bundle.loadJS({})",
                  serde_json::to_string(&specifier)?
                )
              },
            );
          }
          for url in &plan.client_css {
            write!(
              dest,
              "$rsc.preinit({},{{as:'style',precedence:'default'}});\n",
              serde_json::to_string(url)?
            )?;
            if !dependency.flags.contains(DependencyFlags::REACT_LAZY) {
              css.push(format!("$rsc.waitForCSS({})", serde_json::to_string(url)?));
            }
          }
          write!(dest, "let $promise=Promise.all([{}])", loads.join(","))?;
          if !css.is_empty() {
            write!(dest, ".then(()=>Promise.all([{}]))", css.join(","))?;
          }
          write!(
            dest,
            ".then(()=>{{let $original={}({});return $rsc.createResourcesProxy($original,{},$resources",
            require,
            original_id,
            original_asset.flags.contains(AssetFlags::IS_ESM)
          )?;
          if bootstrap_script.is_some() {
            write!(dest, ",$bootstrapScript")?;
          }
          write!(dest, ");}});\nmodule.exports=$promise;\n")?;
        } else {
          let original = if target_bundle.target.output_format == OutputFormat::Commonjs {
            serde_json::to_string(&target_bundle.relative_specifier(bundle).unwrap())?
          } else {
            original_id
          };
          write!(
            dest,
            "let $original={}({});\nmodule.exports=$rsc.createResourcesProxy($original,{},$resources",
            require,
            original,
            original_asset.flags.contains(AssetFlags::IS_ESM)
          )?;
          if bootstrap_script.is_some() {
            write!(dest, ",$bootstrapScript")?;
          }
          write!(dest, ");\n")?;
        }
      }
      SyntheticAsset::RscServerEntry {
        runtime, actions, ..
      } => {
        let require = runtime_name(should_optimize, "require", RUNTIME_REQUIRE);
        let runtime_asset = bundle_graph.asset_graph.assets[*runtime as usize].expect_asset();
        write!(
          dest,
          "let $rsc={}({});\n$rsc.ensureAsyncLocalStorage();\n",
          require,
          serde_json::to_string(&runtime_asset.id(project_root))?
        )?;
        if !actions.is_empty() {
          write!(dest, "$rsc.registerServerActions({{")?;
          for action in actions {
            let asset = bundle_graph.asset_graph.assets[action.asset_index as usize].expect_asset();
            write!(
              dest,
              "{}:{},",
              serde_json::to_string(&asset.id(project_root))?,
              serde_json::to_string(&action.bundles)?
            )?;
          }
          write!(dest, "}});\n")?;
        }
      }
    }

    Ok(())
  }
}

fn load_bundles<W: std::fmt::Write>(
  bundle_graph: &BundleGraph,
  from: &Bundle,
  bundle: &Bundle,
  res: &mut W,
  project_root: &PathId,
  require_name: &str,
) -> core::fmt::Result {
  let main_entry_id = bundle.main_entry_asset.unwrap();
  let asset = &bundle_graph.asset_graph.assets[main_entry_id].expect_asset();

  if !bundle.referenced_bundles.is_empty() {
    write!(res, "module.exports=Promise.all([")?;
    // TODO: recursive
    for referenced_index in &bundle.referenced_bundles {
      load_bundle(&bundle_graph.bundles[*referenced_index], from, res)?;
      write!(res, ", ")?;
    }

    load_bundle(bundle, from, res)?;
    write!(
      res,
      "]).then(()=>{}('{}'));",
      require_name,
      asset.id(project_root)
    )?;
  } else {
    write!(res, "module.exports=")?;
    load_bundle(bundle, from, res)?;
    write!(
      res,
      ".then(()=>{}('{}'));",
      require_name,
      asset.id(project_root)
    )?;
  }

  Ok(())
}

fn load_bundle<W: std::fmt::Write>(
  bundle: &Bundle,
  from: &Bundle,
  res: &mut W,
) -> core::fmt::Result {
  let name = bundle.relative_url(from).unwrap();
  match &bundle.ty {
    AssetType::Js => {
      write!(res, "module.bundle.loadJS('./{}')", name)
    }
    AssetType::Css => {
      write!(res, "module.bundle.loadCSS('./{}')", name)
    }
    _ => Ok(()),
  }
}
