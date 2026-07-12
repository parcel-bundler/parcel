use std::{borrow::Cow, sync::Arc};

use indexmap::{IndexMap, IndexSet};
use parcel_core::*;
use parcel_css::resolve_css_module_export;

use super::{
  Resolution, rsc,
  synthetic::{BundleShim, SyntheticAsset},
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
      dependencies.insert(placeholder.as_str().into(), Resolution::Asset(module.id()));
      additional_assets.insert(SyntheticAsset::Rsc(module));
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
              dependencies.insert(
                placeholder.as_str().into(),
                Resolution::Asset(asset.id(project_root)),
              );
              additional_assets.insert(SyntheticAsset::CssModuleExports(resolved));
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
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Inline,
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
          } else {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Url,
            });
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
