use std::{borrow::Cow, sync::Arc};

use indexmap::{IndexMap, IndexSet};
use parcel_core::*;
use parcel_css::resolve_css_module_export;

use super::{
  Resolution, rsc,
  synthetic::{BundleShim, InlineType, SyntheticAsset},
};

pub(super) fn is_inline_bundle_dependency(dependency: &Dependency, bundle: &Bundle) -> bool {
  dependency.bundle_behavior == BundleBehavior::Inline
    || bundle.bundle_behavior == BundleBehavior::Inline
}

pub(super) fn is_async_bundle_dependency(dependency: &Dependency, bundle: &Bundle) -> bool {
  dependency.priority == Priority::Lazy
    && dependency.specifier_type != SpecifierType::Url
    && !is_inline_bundle_dependency(dependency, bundle)
}

/// Resolves each dependency of an asset for packaging, collecting any synthetic
/// assets that must be emitted alongside it.
pub fn asset_dependencies<'a>(
  asset_index: AssetIndex,
  asset: &'a Asset,
  bundle_graph: &'a BundleGraph,
  bundle: Option<&'a Bundle>,
  additional_assets: &mut IndexSet<SyntheticAsset>,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  project_root: &PathId,
) -> Result<IndexMap<String, Resolution<'a>>, DiagnosticList> {
  let mut dependencies = IndexMap::new();

  let used_deps: Vec<AssetIndex> = bundle_graph
    .asset_graph
    .resolved_dependencies(asset)
    .collect();

  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    let placeholder = dep.placeholder.as_ref().unwrap_or(&dep.specifier);
    let graph_resolution = bundle_graph.dependency_resolution(asset_index, dep_index);
    let resolved = match graph_resolution {
      BundleGraphDependencyResolution::Asset(asset_index) => Some((asset_index, None)),
      BundleGraphDependencyResolution::Bundle(bundle_index) => bundle_graph.bundles
        [bundle_index as usize]
        .main_entry_asset
        .map(|asset_index| (asset_index, Some(bundle_index))),
      _ => None,
    };

    if let Some((resolved_asset, bundle_index)) = resolved
      && let Some(module) = rsc::resolve_dependency(
        asset_index,
        dep_index,
        asset,
        dep,
        resolved_asset,
        bundle_index,
        bundle_graph,
      )?
    {
      dependencies.insert((&**placeholder).into(), Resolution::Asset(module.id()));
      additional_assets.insert(SyntheticAsset::Rsc(module));
      continue;
    }

    match graph_resolution {
      BundleGraphDependencyResolution::Asset(resolved) => {
        let resolved_asset = &bundle_graph.asset_graph.asset(resolved);
        if resolved_asset.ty != AssetType::Js {
          if resolved_asset.symbols.exports.iter().any(|e| e.requested) {
            let asset = &bundle_graph.asset_graph.asset(resolved);
            dependencies.insert(
              (&**placeholder).into(),
              Resolution::Asset(asset.id(project_root)),
            );
            additional_assets.insert(SyntheticAsset::CssModuleExports(resolved));
            continue;
          }
          dependencies.insert((&**placeholder).into(), Resolution::Excluded);
          continue;
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
                  let asset = &bundle_graph.asset_graph.asset(*asset_index);
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
                  let asset = &bundle_graph.asset_graph.asset(*asset_index);
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
                  let asset = &bundle_graph.asset_graph.asset(*asset_index);
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
            let asset = &bundle_graph.asset_graph.asset(res);
            dependencies.insert(
              (&**placeholder).into(),
              Resolution::Asset(asset.id(project_root)),
            );
          } else {
            dependencies.insert((&**placeholder).into(), Resolution::Symbols(resolutions));
          }
        } else if !used_deps.contains(&resolved) {
          dependencies.insert((&**placeholder).into(), Resolution::Excluded);
        } else {
          let asset = &bundle_graph.asset_graph.asset(resolved);
          dependencies.insert(
            (&**placeholder).into(),
            Resolution::Asset(asset.id(project_root)),
          );
        }
      }
      BundleGraphDependencyResolution::None => {}
      BundleGraphDependencyResolution::Deferred => {
        dependencies.insert((&**placeholder).into(), Resolution::Excluded);
      }
      BundleGraphDependencyResolution::Excluded | BundleGraphDependencyResolution::External => {
        if dep.specifier_type == SpecifierType::Url {
          dependencies.insert(
            (&**placeholder).into(),
            Resolution::String(Cow::Borrowed(&dep.specifier)),
          );
        } else {
          dependencies.insert(
            (&**placeholder).into(),
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
            let content = get_inline_bundle_content(bundle_index as usize).unwrap();
            let resolution = match dep.import_type {
              ImportType::Bytes => Resolution::Bytes(content.read()?),
              ImportType::StyleSheet => {
                Resolution::StyleSheet(Cow::Owned(content.read_string()?.into_owned()))
              }
              _ => Resolution::String(Cow::Owned(content.read_string()?.into_owned())),
            };
            dependencies.insert((&**placeholder).into(), resolution);
          } else if dep.specifier_type == SpecifierType::Url || dep.import_type == ImportType::Url {
            dependencies.insert(
              (&**placeholder).into(),
              Resolution::String(resolved_bundle.relative_url(bundle).unwrap().into()),
            );
          } else {
            if resolved_bundle.ty != AssetType::Js
              && let Some(main) = resolved_bundle.main_entry_asset
            {
              let asset = &bundle_graph.asset_graph.asset(main);
              let mut exports = Vec::new();
              for exp in &asset.symbols.exports {
                if !exp.requested {
                  continue;
                }

                if let Some(value) =
                  resolve_css_module_export(&bundle_graph.asset_graph, main, exp.exported.as_str())
                {
                  exports.push((exp.exported.as_str(), value));
                }
              }

              if !exports.is_empty() {
                dependencies.insert(
                  (&**placeholder).into(),
                  Resolution::CssModule(
                    resolved_bundle.relative_specifier(bundle).unwrap(),
                    exports,
                  ),
                );
                continue;
              }
            }
            dependencies.insert(
              (&**placeholder).into(),
              Resolution::External(resolved_bundle.relative_specifier(bundle).unwrap().into()),
            );
          }
        } else {
          let is_lazy_dynamic_import = is_async_bundle_dependency(dep, resolved_bundle);
          let is_inline = is_inline_bundle_dependency(dep, resolved_bundle);
          // TODO: this is wrong. It should be if the _target_ module is CJS. But this breaks some dynamic_import tests. Would be a behavior change.
          let needs_esm_interop =
            is_lazy_dynamic_import && !is_inline && asset.flags.contains(AssetFlags::IS_ESM);

          let inline_type = InlineType::from(dep.import_type);
          if is_inline {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Inline(inline_type),
            });
          } else if is_lazy_dynamic_import {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Async,
            });
            if needs_esm_interop {
              additional_assets.insert(SyntheticAsset::Bundle {
                bundle: bundle_index,
                kind: BundleShim::AsyncInterop,
              });
            }
          } else if resolved_bundle.ty == AssetType::Json
            && dep.import_type == ImportType::JavaScript
          {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Sync,
            });
          } else {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Url,
            });
          };

          let resolution = if needs_esm_interop {
            Resolution::BundleInterop(bundle_index)
          } else if is_inline && inline_type != InlineType::Text {
            // Bytes and StyleSheet shims have distinct module ids from the plain "b{n}" form.
            Resolution::Asset(BundleShim::Inline(inline_type).id(bundle_index))
          } else {
            Resolution::Bundle(bundle_index)
          };
          dependencies.insert((&**placeholder).into(), resolution);
        }
      }
    }
  }

  Ok(dependencies)
}
