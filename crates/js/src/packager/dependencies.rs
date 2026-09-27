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

/// Bundles whose names or inline content packaging `bundle` may access. This must cover every
/// `relative_url`/`relative_specifier`/`absolute_url` call and inline content read made by the JS
/// packagers (see `Content::bundle_dependencies`), and mirrors the classification in
/// `asset_dependencies` and the synthetic modules it creates.
pub(crate) fn bundle_dependencies(bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
  if bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
    // Library bundles embed a relative path or the inline content for every bundle reference.
    return bundle_graph.bundle_dependency_targets(bundle).collect();
  }

  if bundle.target.source_type == SourceType::Script {
    // Classic scripts are emitted as is, without resolving dependencies.
    return Vec::new();
  }

  let mut dependencies = Vec::new();

  // A root's runtime maps the stable keys of everything its context loads to final names.
  if holds_manifest(bundle_graph, bundle) {
    dependencies.extend(bundle_graph.context_closure(bundle));
  }
  // Statically imported bundles are imported by relative path.
  dependencies.extend(static_imports(bundle_graph, bundle));

  let is_rsc = matches!(
    bundle.target.environment,
    Environment::ReactServer | Environment::ReactClient
  );
  if is_rsc {
    // Client references embed URLs of CSS in the importer's bundle group, and final names of the
    // client bundles they load (see `rsc::client_bundle_import_map`).
    // They're computed from the first bundle containing the importer, which may be a copy of this
    // one's assets in another bundle.
    let mut importer_bundles: Vec<usize> = bundle.referenced_bundles.clone();
    for &asset_index in &bundle.assets {
      if let Some(importer_bundle) = bundle_graph.first_bundle_containing(asset_index)
        && !importer_bundles.contains(&importer_bundle)
      {
        importer_bundles.push(importer_bundle);
      }
    }
    for importer_bundle in importer_bundles {
      dependencies.extend(bundle_graph.referenced_bundles(importer_bundle));
      dependencies.extend(rsc::client_bundle_import_map_dependencies(
        bundle_graph,
        importer_bundle as u32,
      ));
    }
  }

  for &asset_index in &bundle.assets {
    let asset = bundle_graph.asset_graph.asset(asset_index);
    for (dep_index, dep) in asset.dependencies.iter().enumerate() {
      let BundleGraphDependencyResolution::Bundle { bundle_index, .. } =
        bundle_graph.dependency_resolution(asset_index, dep_index)
      else {
        continue;
      };
      let bundle_index = bundle_index as usize;
      let resolved_bundle = &bundle_graph.bundles[bundle_index];

      if is_inline_bundle_dependency(dep, resolved_bundle) {
        dependencies.push(bundle_index);
      } else if is_rsc {
        // RSC boundaries embed URLs of the target's bundle group and may load it by path.
        dependencies.extend(bundle_graph.referenced_bundles(bundle_index));
        dependencies.extend(rsc::client_bundle_import_map_dependencies(
          bundle_graph,
          bundle_index as u32,
        ));
      } else if is_async_bundle_dependency(dep, resolved_bundle) {
        // CommonJS bundles are loaded by relative path; others by stable key.
        dependencies.extend(
          bundle_graph
            .referenced_bundles(bundle_index)
            .filter(|&index| is_loaded_by_path(&bundle_graph.bundles[index])),
        );
      } else if is_sync_bundle_dependency(dep, resolved_bundle) {
        dependencies.push(bundle_index);
      }
    }
  }

  dependencies
}

/// Whether `bundle`'s runtime holds its context's manifest. Roots that are only loaded by pages get
/// it from the page instead, so they don't depend on their whole context.
fn holds_manifest(bundle_graph: &BundleGraph, bundle: &Bundle) -> bool {
  bundle.is_context_root() && !bundle_graph.is_page_hosted(bundle)
}

/// JS bundles `bundle` imports so they're loaded before it runs. Roots that nothing else loads
/// the closure for import all of them. Parcel's loader, pages and RSC load a bundle's static closure
/// within its environment, so other bundles only import the bundles they reference in other
/// environments (e.g. server code importing modules `with {env: 'react-client'}`).
pub(super) fn static_imports(bundle_graph: &BundleGraph, bundle: &Bundle) -> Vec<usize> {
  let is_root = holds_manifest(bundle_graph, bundle);
  let mut imports: Vec<usize> = Vec::new();
  for &referenced in &bundle.referenced_bundles {
    for index in bundle_graph.referenced_bundles(referenced) {
      let imported = &bundle_graph.bundles[index];
      if imported.ty == AssetType::Js
        && imported.id != bundle.id
        && (is_root || imported.target.environment != bundle.target.environment)
        && !imports.contains(&index)
      {
        imports.push(index);
      }
    }
  }
  imports
}

/// The manifest a context root's runtime starts with: the final names of content hashed bundles
/// its context loads by stable key. Sorted by key, so the output is deterministic.
pub(super) fn manifest_entries(
  bundle_graph: &BundleGraph,
  bundle: &Bundle,
) -> Vec<(String, String)> {
  if !holds_manifest(bundle_graph, bundle) {
    return Vec::new();
  }
  let mut entries: Vec<(String, String)> = bundle_graph
    .context_closure(bundle)
    .into_iter()
    .map(|index| &bundle_graph.bundles[index])
    .filter(|target| target.has_final_path())
    .map(|target| (target.stable_key(), target.name()))
    .filter(|(stable_key, name)| stable_key != name)
    .collect();
  entries.sort_unstable();
  entries
}

/// Whether the async loader references `bundle` by relative path rather than by stable key.
fn is_loaded_by_path(bundle: &Bundle) -> bool {
  bundle.ty == AssetType::Js && bundle.target.output_format == OutputFormat::Commonjs
}

/// A JSON bundle imported as JavaScript, which is imported or required synchronously by path.
fn is_sync_bundle_dependency(dependency: &Dependency, bundle: &Bundle) -> bool {
  bundle.ty == AssetType::Json && dependency.import_type == ImportType::JavaScript
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
      BundleGraphDependencyResolution::Bundle {
        bundle_index,
        asset_index,
      } => Some((asset_index, Some(bundle_index))),
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
      BundleGraphDependencyResolution::Bundle {
        bundle_index,
        asset_index,
      } => {
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
            if resolved_bundle.ty != AssetType::Js {
              let asset = &bundle_graph.asset_graph.asset(asset_index);
              let mut exports = Vec::new();
              for exp in &asset.symbols.exports {
                if !exp.requested {
                  continue;
                }

                if let Some(value) = resolve_css_module_export(
                  &bundle_graph.asset_graph,
                  asset_index,
                  exp.exported.as_str(),
                ) {
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
          let resolution = if is_inline {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Inline(inline_type),
            });
            Resolution::Asset(BundleShim::Inline(inline_type).id(bundle_index, bundle_graph))
          } else if is_lazy_dynamic_import {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Async(asset_index),
            });
            if needs_esm_interop {
              additional_assets.insert(SyntheticAsset::Bundle {
                bundle: bundle_index,
                kind: BundleShim::AsyncInterop(asset_index),
              });
              Resolution::Asset(
                BundleShim::AsyncInterop(asset_index).id(bundle_index, bundle_graph),
              )
            } else {
              Resolution::Asset(BundleShim::Async(asset_index).id(bundle_index, bundle_graph))
            }
          } else if is_sync_bundle_dependency(dep, resolved_bundle) {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Sync,
            });
            Resolution::Asset(BundleShim::Sync.id(bundle_index, bundle_graph))
          } else {
            additional_assets.insert(SyntheticAsset::Bundle {
              bundle: bundle_index,
              kind: BundleShim::Url,
            });
            Resolution::Asset(BundleShim::Url.id(bundle_index, bundle_graph))
          };
          dependencies.insert((&**placeholder).into(), resolution);
        }
      }
      BundleGraphDependencyResolution::Internalized(asset_index) => {
        let resolved = bundle_graph.asset_graph.asset(asset_index);
        // Match the async loader's interop policy even when ESM and CommonJS
        // importers share the same internalized target.
        let resolution = if asset.flags.contains(AssetFlags::IS_ESM) {
          let shim = SyntheticAsset::InternalizedInterop(asset_index);
          let id = shim.id(bundle_graph, project_root);
          additional_assets.insert(shim);
          Resolution::Asset(id)
        } else {
          Resolution::Internalized(resolved.id(project_root))
        };
        dependencies.insert((&**placeholder).into(), resolution);
        additional_assets.insert(SyntheticAsset::Internalized(asset_index));
      }
    }
  }

  Ok(dependencies)
}
