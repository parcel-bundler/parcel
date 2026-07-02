use std::{borrow::Cow, fmt::Write, sync::Arc};

use indexmap::{IndexMap, IndexSet};
use parcel_core::*;
use parcel_js_swc_core::tree_shake::tree_shake;

use parcel_css::resolve_css_module_export;

pub use parcel_js_swc_core::tree_shake::Resolution;

use crate::JsContent;

impl JsContent {
  pub(crate) fn package_app(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
    options: &ParcelOptions,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    const RUNTIME: &str = include_str!("runtime.js");
    const DEV_RUNTIME: &str = include_str!("dev-runtime.js");

    if bundle.target.source_type == SourceType::Script {
      assert_eq!(bundle.assets.len(), 1);
      let asset = bundle_graph.asset_graph.assets[bundle.main_entry_asset.unwrap()].expect_asset();
      return Ok(asset.content.clone());
    }

    let mut res = String::new();
    if let Some(main) = bundle.main_entry_asset {
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[main] {
        if let Some(content) = asset.content.downcast_ref::<JsContent>() {
          if let Some(shebang) = &content.shebang {
            write!(res, "#!{}\n", shebang)?;
          }
        }
      }
    }

    for b in &bundle.referenced_bundles {
      let referenced = &bundle_graph.bundles[*b];
      if referenced.ty != AssetType::Js {
        continue;
      }

      write!(
        res,
        "import '{}';\n",
        referenced.relative_specifier(&bundle).unwrap()
      )?;
    }

    write!(res, "var modules = {{\n")?;

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
          res.push(',');
        }
        first = false;

        if bundle
          .target
          .flags
          .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
          && let Some(content) = asset.content.downcast_ref::<JsContent>()
        {
          // TODO: this mutates the ast stored in the asset, which will break incremental rebuilds.
          let mut ast = content.ast.lock().unwrap();
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
          );
          tree_shake(&mut ast, used_symbols, dependencies, dirname, true);
          let (code, _map) = ast.to_code(false, true)?;

          write!(
            res,
            "'{}':[function(require,module,exports) {{\n{}\n}}]",
            asset.id(&options.project_root),
            String::from_utf8_lossy(&code),
          )?;
        } else {
          let code = asset.content.read()?;
          let deps = serde_json::to_string(&dependencies)?;
          write!(
            res,
            "'{}':[function(require,module,exports) {{\n{}\n}}, {}]",
            asset.id(&options.project_root),
            String::from_utf8_lossy(&code),
            deps
          )?;
        }
      }
    }

    for synthetic_asset in synthetic_assets {
      if !first {
        res.push(',');
      }
      first = false;

      synthetic_asset.write_id(&mut res)?;
      write!(res, ":[function(require,module,exports) {{\n")?;
      synthetic_asset.write_content(
        &mut res,
        bundle_graph,
        bundle,
        get_inline_bundle_content,
        &options.project_root,
      )?;
      let deps =
        serde_json::to_string(&synthetic_asset.dependencies(bundle_graph, &options.project_root))?;
      write!(res, "\n}},{}]", deps)?;
    }

    write!(res, "}};\n\n")?;
    write!(
      res,
      r#"var parcelRequireName = 'parcelRequire';
var externals = {{}};
var entries = ["#,
    )?;
    for entry in &bundle.entry_assets {
      let asset = &bundle_graph.asset_graph.assets[*entry].expect_asset();
      write!(res, "'{}'", asset.id(&options.project_root))?;
    }

    write!(res, "];\nvar mainEntry = ")?;
    if let Some(main) = &bundle.main_entry_asset {
      let asset = &bundle_graph.asset_graph.assets[*main].expect_asset();
      write!(res, "'{}';\n", asset.id(&options.project_root))?;
    } else {
      write!(res, "null;\n")?;
    }

    res.push_str(if options.mode == BuildMode::Development {
      DEV_RUNTIME
    } else {
      RUNTIME
    });

    Ok(Arc::new(BufferContent::new(res.into_bytes())))
  }
}

#[derive(PartialEq, Eq, Hash)]
pub enum SyntheticAsset {
  Asset(String, u32),
  Async(u32),
  AsyncInterop(u32),
  Url(u32),
  Inline(u32),
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
    match bundle_graph.dependency_resolution(asset_index, dep_index) {
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

          if dep.target.environment == Environment::ReactServer
            && resolved_asset.target.environment == Environment::ReactClient
          {
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
          let is_lazy_dynamic_import =
            dep.priority == Priority::Lazy && dep.specifier_type != SpecifierType::Url;
          let is_inline = dep.bundle_behavior == BundleBehavior::Inline
            || resolved_bundle.bundle_behavior == BundleBehavior::Inline;
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

impl SyntheticAsset {
  pub fn id(&self) -> String {
    match self {
      SyntheticAsset::Asset(id, _) => id.clone(),
      SyntheticAsset::Async(id) => format!("b{}", id),
      SyntheticAsset::AsyncInterop(id) => format!("b{}i", id),
      SyntheticAsset::Url(id) => format!("b{}", id),
      SyntheticAsset::Inline(id) => format!("b{}", id),
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
      _ => {}
    }

    dependencies
  }

  pub fn write_id<W: std::fmt::Write>(&self, dest: &mut W) -> std::fmt::Result {
    match self {
      SyntheticAsset::Asset(id, _) => write!(dest, "'{}'", id),
      SyntheticAsset::Async(id) => write!(dest, "'b{}'", id),
      SyntheticAsset::AsyncInterop(id) => write!(dest, "'b{}i'", id),
      SyntheticAsset::Url(id) => write!(dest, "'b{}'", id),
      SyntheticAsset::Inline(id) => write!(dest, "'b{}'", id),
    }
  }

  pub fn write_content<W: std::fmt::Write>(
    &self,
    dest: &mut W,
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
              write!(
                dest,
                "exports[{:?}] = '{}';\n",
                exp.exported.as_str(),
                value
              )?;
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
        load_bundles(bundle_graph, bundle, resolved_bundle, dest, project_root)?;
        // }
      }
      SyntheticAsset::AsyncInterop(bundle_index) => {
        write!(
          dest,
          "module.exports=require(\"b{}\").then(function(m){{return m&&m.__esModule?m:{{default:m}};}});",
          bundle_index
        )?;
      }
      SyntheticAsset::Inline(bundle_index) => {
        let content = get_inline_bundle_content(*bundle_index as usize)?.read()?;
        write!(
          dest,
          "module.exports={:?};",
          String::from_utf8_lossy(&content)
        )?;
      }
      SyntheticAsset::Url(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];
        write!(
          dest,
          "module.exports=new URL({:?}, import.meta.url).toString();",
          resolved_bundle.relative_url(&bundle).unwrap()
        )?;
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
    write!(res, "]).then(() => require('{}'));", asset.id(project_root))?;
  } else {
    write!(res, "module.exports=")?;
    load_bundle(bundle, from, res)?;
    write!(res, ".then(() => require('{}'));", asset.id(project_root))?;
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

fn load_bundles_rsc<W: std::fmt::Write>(
  bundle_graph: &BundleGraph,
  from: &Bundle,
  bundle: &Bundle,
  res: &mut W,
) -> core::fmt::Result {
  let mut resources = Vec::new();
  let mut promises = Vec::new();
  for referenced_index in &bundle.referenced_bundles {
    let referenced_bundle = &bundle_graph.bundles[*referenced_index];
    load_bundle_rsc(referenced_bundle, from, res, &mut resources, &mut promises)?;
  }

  load_bundle_rsc(bundle, from, res, &mut resources, &mut promises)?;

  write!(res, "module.exports=Promise.all([")?;
  for p in promises {
    write!(res, "{},", p)?;
  }

  write!(res, "])")?;
  if !resources.is_empty() {
    write!(
      res,
      ".then(()=>createResourcesProxy(require({}), resources))",
      bundle.main_entry_asset.unwrap()
    )?;
  }

  write!(res, ";\n")?;
  Ok(())
}

fn load_bundle_rsc<W: std::fmt::Write>(
  bundle: &Bundle,
  from: &Bundle,
  res: &mut W,
  resources: &mut Vec<String>,
  promises: &mut Vec<String>,
) -> core::fmt::Result {
  let name = bundle.relative_url(&from).unwrap();
  match &bundle.ty {
    AssetType::Js => {
      if bundle.target.environment.is_browser() {
        if bundle.target.environment.is_browser() {
          if bundle.target.output_format == OutputFormat::Esmodule {
            // TODO: how to import jsx runtime?
            resources.push(format!("<link rel='modulepreload' href='{}' />", name));
          } else {
            resources.push(format!(
              "<link rel='preload' as='script' href='{}' />",
              name
            ));
          }
        }
      }

      if bundle.target.environment == bundle.target.environment {
        promises.push(format!("parcelLoadJS('./{}')", name));
      }
    }
    AssetType::Css => {
      resources.push(format!(
        "<link rel='stylesheet' href='{}' precedence='default' />",
        name
      ));
      if bundle.target.environment.is_browser() {
        // TODO: only if not react lazy
        promises.push(format!("waitForCSS('{}')", name));
        write!(
          res,
          "preinit('{}', {{as: 'style', precedence: 'default'}});\n",
          name
        )?;
      }
    }
    _ => {}
  }

  Ok(())
}
