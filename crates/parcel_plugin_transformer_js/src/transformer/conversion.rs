use std::path::PathBuf;
use std::sync::Arc;

use indexmap::IndexMap;
use swc_core::atoms::Atom;

use parcel_core::plugin::TransformResult;
use parcel_core::types::engines::EnvironmentFeature;
use parcel_core::types::{
  Asset, BundleBehavior, Code, Dependency, Diagnostic, Environment, EnvironmentContext, FileType,
  ImportAttribute, IncludeNodeModules, OutputFormat, ParcelOptions, SourceLocation, SourceType,
  SpecifierType, Symbol,
};

use crate::transformer::conversion::dependency_kind::{convert_priority, convert_specifier_type};
use crate::transformer::conversion::loc::convert_loc;
use crate::transformer::conversion::symbol::{
  transformer_collect_imported_symbol_to_symbol, transformer_exported_symbol_into_symbol,
  transformer_imported_symbol_to_symbol,
};

mod dependency_kind;
mod loc;
/// Conversions from SWC symbol types into [`Symbol`]
mod symbol;

pub(crate) fn convert_result(
  mut asset: Asset,
  transformer_config: &parcel_js_swc_core::Config,
  result: parcel_js_swc_core::TransformResult,
  options: &ParcelOptions,
) -> Result<TransformResult, Vec<Diagnostic>> {
  let asset_file_path = asset.file_path.to_path_buf();
  let asset_environment = asset.env.clone();
  let asset_id = asset.id();

  if let Some(shebang) = result.shebang {
    asset.set_interpreter(shebang);
  }

  let (mut dependency_by_specifier, invalidate_on_file_change) = convert_dependencies(
    transformer_config,
    result.dependencies,
    &asset_file_path,
    &asset_environment,
    asset_id,
  )?;

  if result.needs_esm_helpers {
    let has_symbols = result.hoist_result.is_some() || result.symbol_result.is_some();
    let dependency = make_esm_helpers_dependency(
      options,
      &asset_file_path,
      (*asset_environment).clone(),
      has_symbols,
      asset_id,
    );
    dependency_by_specifier.insert(dependency.specifier.as_str().into(), dependency);
  }

  if let Some(hoist_result) = result.hoist_result {
    // Has symbols is currently needed to differentiate between assets with no symbols vs assets
    // which haven't had symbols analyzed yet.
    // TODO: replace `asset.symbols` with `Option<Vec<...>>`
    asset.has_symbols = true;

    // Pre-allocate expected symbols
    asset
      .symbols
      .reserve(hoist_result.exported_symbols.len() + hoist_result.re_exports.len() + 1);

    // Collect all exported variable names into `asset.symbols`
    for symbol in &hoist_result.exported_symbols {
      let symbol = transformer_exported_symbol_into_symbol(&asset_file_path, &symbol);
      asset.symbols.push(symbol);
    }

    // Collect all imported symbols into each of the corresponding dependencies' symbols array
    for symbol in hoist_result.imported_symbols {
      if let Some(dependency) = dependency_by_specifier.get_mut(&symbol.source) {
        let symbol = transformer_imported_symbol_to_symbol(&asset_file_path, &symbol);
        dependency.symbols.push(symbol);
      }
    }

    for symbol in hoist_result.re_exports {
      if let Some(dependency) = dependency_by_specifier.get_mut(&symbol.source) {
        if is_re_export_all_symbol(&symbol) {
          let loc = Some(convert_loc(asset_file_path.clone(), &symbol.loc));
          dependency.symbols.push(make_export_all_symbol(loc));
          // TODO: Why isn't this added to the asset.symbols array?
        } else {
          let existing = dependency
            .symbols
            .as_slice()
            .iter()
            .find(|candidate| candidate.exported == &*symbol.imported);

          // `re_export_fake_local_key` is a generated mangled identifier only for purposes of
          // keying this `Symbol`. It is not actually inserted onto the file.
          //
          // Unlike other symbols, we're generating the mangled name in here rather than in the
          // SWC transformer implementation.
          // TODO: Move this into the SWC transformer
          let re_export_fake_local_key = existing
            .map(|sym| sym.local.clone())
            .unwrap_or_else(|| format!("${:016x}$re_export${}", asset_id, symbol.local).into());
          let symbol = Symbol {
            exported: symbol.imported.as_ref().into(),
            local: re_export_fake_local_key.clone(),
            loc: Some(convert_loc(asset_file_path.clone(), &symbol.loc)),
            is_weak: existing.map(|e| e.is_weak).unwrap_or(true),
            ..Symbol::default()
          };

          dependency.symbols.push(symbol.clone());
          asset.symbols.push(symbol);
        }
      }
    }

    for specifier in hoist_result.wrapped_requires {
      if let Some(dep) = dependency_by_specifier.get_mut(&swc_core::atoms::JsWord::new(specifier)) {
        dep.should_wrap = true;
      }
    }

    // for (name, specifier) in hoist_result.dynamic_imports {
    //   if let Some(dep) = dependency_by_specifier.get_mut(&specifier) {
    //     dep.promise_symbol = Some((&*name).into());
    //   }
    // }

    for name in hoist_result.self_references {
      // Do not create a self-reference for the `default` symbol unless we have seen an __esModule flag.
      if &*name == "default"
        && !asset
          .symbols
          .as_slice()
          .iter()
          .any(|s| &*s.exported == "__esModule")
      {
        continue;
      }

      let symbol = asset
        .symbols
        .iter_mut()
        .find(|s| s.exported.as_str() == name.as_str())
        .unwrap();

      symbol.self_referenced = true;
    }

    // Add * symbol if there are CJS exports, no imports/exports at all
    // (and the asset has side effects), or the asset is wrapped.
    // This allows accessing symbols that don't exist without errors in symbol propagation.
    if (hoist_result.has_cjs_exports
      || (!hoist_result.is_esm
        && asset.side_effects
        && dependency_by_specifier.is_empty()
        && hoist_result.exported_symbols.is_empty())
      || hoist_result.should_wrap)
      && !asset.symbols.as_slice().iter().any(|s| s.exported == "*")
    {
      asset.symbols.push(make_export_star_symbol(asset_id));
    }

    asset.has_cjs_exports = hoist_result.has_cjs_exports;
    asset.static_exports = hoist_result.static_cjs_exports;
    asset.should_wrap = hoist_result.should_wrap;
  } else {
    if let Some(symbol_result) = result.symbol_result {
      asset.has_symbols = true;
      asset.symbols.reserve(symbol_result.exports.len() + 1);
      for sym in &symbol_result.exports {
        let (local, is_weak) = if let Some(dep) = sym
          .source
          .as_ref()
          .and_then(|source| dependency_by_specifier.get_mut(source))
        {
          let local = format!("${:016x}${}", dep.id(), sym.local);
          dep.symbols.push(Symbol {
            exported: sym.local.as_ref().into(),
            local: local.clone(),
            loc: Some(convert_loc(asset_file_path.clone(), &sym.loc)),
            is_weak: true,
            ..Symbol::default()
          });
          (local, true)
        } else {
          (format!("${}", sym.local).into(), false)
        };

        asset.symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: Some(convert_loc(asset_file_path.clone(), &sym.loc)),
          is_weak,
          ..Symbol::default()
        });
      }

      for sym in symbol_result.imports {
        if let Some(dep) = dependency_by_specifier.get_mut(&sym.source) {
          dep
            .symbols
            .push(transformer_collect_imported_symbol_to_symbol(
              &asset_file_path,
              &sym,
            ));
        }
      }

      for sym in symbol_result.exports_all {
        if let Some(dep) = dependency_by_specifier.get_mut(&sym.source) {
          let loc = Some(convert_loc(asset_file_path.clone(), &sym.loc));
          dep.symbols.push(make_export_all_symbol(loc));
        }
      }

      // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if symbol_result.has_cjs_exports
        || (!symbol_result.is_esm
          && asset.side_effects
          && dependency_by_specifier.is_empty()
          && symbol_result.exports.is_empty())
        || (symbol_result.should_wrap
          && !asset.symbols.as_slice().iter().any(|s| s.exported == "*"))
      {
        asset.symbols.push(make_export_star_symbol(asset_id));
      }
    } else {
      // If the asset is wrapped, add * as a fallback
      asset.symbols.push(make_export_star_symbol(asset_id));
    }

    // For all other imports and requires, mark everything as imported (this covers both dynamic
    // imports and non-top-level requires.)
    for dep in dependency_by_specifier.values_mut() {
      if dep.symbols.is_empty() {
        dep.symbols.push(Symbol {
          exported: "*".into(),
          local: format!("${}$", dep.specifier), // TODO: coalesce with dep.placeholder
          loc: None,
          ..Default::default()
        });
      }
    }
  }

  asset.has_node_replacements = result.has_node_replacements;
  asset.is_constant_module = result.is_constant_module;

  if asset.unique_key.is_none() {
    asset.unique_key = Some(format!("{:016x}", asset_id));
  }
  asset.asset_type = FileType::Js;

  // Overwrite the source-code with SWC output
  let result_source_code_string = String::from_utf8(result.code)
    // TODO: This is impossible; but we should extend 'diagnostic' type to be nicer / easier to build
    .map_err(|_| vec![])?;
  asset.code = Arc::new(Code::from(result_source_code_string));

  Ok(TransformResult {
    asset,
    dependencies: dependency_by_specifier.into_values().collect(),
    // map: result.map,
    // shebang: result.shebang,
    // dependencies: deps,
    // diagnostics: result.diagnostics,
    // used_env: result.used_env.into_iter().map(|v| v.to_string()).collect(),
    invalidate_on_file_change,
  })
}

/// Returns true if this `ImportedSymbol` corresponds to a statement such as:
///
/// ```skip
/// export * from 'other';
/// ```
///
/// See [`HoistResult::re_exports`]
pub(crate) fn is_re_export_all_symbol(symbol: &parcel_js_swc_core::ImportedSymbol) -> bool {
  symbol.local == "*" && symbol.imported == "*"
}

/// Convert the SWC transformer dependency descriptors into the core `Dependency` type.
///
/// Collect the dependencies by their local scope-hoisting names that the transformer has output
/// onto the file. This returns a map of mangled JS name (that the transformer generated) to the
/// dependency value.
///
/// This will be used to find dependencies corresponding to imported symbols' `local` mangled names.
pub(crate) fn convert_dependencies(
  transformer_config: &parcel_js_swc_core::Config,
  dependencies: Vec<parcel_js_swc_core::DependencyDescriptor>,
  asset_file_path: &PathBuf,
  asset_environment: &Environment,
  asset_id: u64,
) -> Result<(IndexMap<Atom, Dependency>, Vec<PathBuf>), Vec<Diagnostic>> {
  let mut dependency_by_specifier = IndexMap::new();
  let mut invalidate_on_file_change = Vec::new();
  for transformer_dependency in dependencies {
    let placeholder = transformer_dependency
      .placeholder
      .as_ref()
      .map(|d| d.as_str().into())
      .unwrap_or_else(|| transformer_dependency.specifier.clone());

    let result = convert_dependency(
      transformer_config,
      &asset_file_path,
      &asset_environment,
      asset_id,
      transformer_dependency,
    )?;

    match result {
      DependencyConversionResult::Dependency(dependency) => {
        dependency_by_specifier.insert(placeholder, dependency);
      }
      DependencyConversionResult::InvalidateOnFileChange(file_path) => {
        invalidate_on_file_change.push(file_path);
      }
    }
  }
  Ok((dependency_by_specifier, invalidate_on_file_change))
}

/// "Export star" symbol is added as a placeholder for assets that may have symbols that aren't
/// explicitly listed. This is used to avoid errors if a symbol that hasn't been statically
/// analyzed is accessed.
fn make_export_star_symbol(asset_id: u64) -> Symbol {
  Symbol {
    exported: "*".into(),
    // This is the mangled exports name
    local: format!("${:016x}$exports", asset_id).into(),
    loc: None,
    ..Default::default()
  }
}

fn make_esm_helpers_dependency(
  options: &ParcelOptions,
  asset_file_path: &PathBuf,
  asset_environment: Environment,
  has_symbols: bool,
  asset_id: u64,
) -> Dependency {
  Dependency {
    source_asset_id: Some(format!("{:016x}", asset_id)),
    specifier: "@parcel/transformer-js/src/esmodule-helpers.js".into(),
    specifier_type: SpecifierType::Esm,
    source_path: Some(asset_file_path.clone()),
    env: Environment {
      include_node_modules: IncludeNodeModules::Map(
        [("@parcel/transformer-js".to_string(), true)]
          .into_iter()
          .collect(),
      ),
      ..asset_environment.clone()
    }
    .into(),
    resolve_from: Some(options.core_path.as_path().into()),
    has_symbols,
    ..Default::default()
  }
}

/// This will replace the hoist result symbols that `is_re_export_all` returns true for as well
/// as the `symbol_result.exports_all` symbols.
///
/// These correspond to `export * from './dep';` statements.
fn make_export_all_symbol(loc: Option<SourceLocation>) -> Symbol {
  Symbol {
    exported: "*".into(),
    local: "*".into(),
    loc,
    is_weak: true,
    ..Default::default()
  }
}

enum DependencyConversionResult {
  Dependency(Dependency),
  /// Only for [`parcel_js_swc_core::DependencyKind::File`] dependencies, the output will not be a
  /// [`Dependency`] but just an invalidation.
  InvalidateOnFileChange(PathBuf),
}

/// Convert dependency from the transformer `parcel_js_swc_core::DependencyDescriptor` into a
/// `DependencyConversionResult`.
fn convert_dependency(
  transformer_config: &parcel_js_swc_core::Config,
  asset_file_path: &PathBuf,
  asset_environment: &Environment,
  asset_id: u64,
  transformer_dependency: parcel_js_swc_core::DependencyDescriptor,
) -> Result<DependencyConversionResult, Vec<Diagnostic>> {
  use parcel_js_swc_core::DependencyKind;

  let loc = convert_loc(asset_file_path.clone(), &transformer_dependency.loc);
  let base_dependency = Dependency {
    source_asset_id: Some(format!("{:016x}", asset_id)),
    specifier: transformer_dependency.specifier.as_ref().into(),
    specifier_type: convert_specifier_type(&transformer_dependency),
    source_path: Some(asset_file_path.clone()),
    priority: convert_priority(&transformer_dependency),
    loc: Some(loc.clone()),
    ..Dependency::default()
  };
  let source_type = convert_source_type(&transformer_dependency.source_type);
  match transformer_dependency.kind {
    // For all of web-worker, service-worker, worklet and URL we should probably set BundleBehaviour
    // to "isolated". At the moment though it is set to None on all but worklet.
    //
    // `output_format` here corresponds to `{ type: '...' }` on the `new Worker` or
    // `serviceWorker.register` calls
    //
    // ```skip
    // let worker = new Worker(
    //  new URL("./dependency", import.meta.url),
    //  {type: 'module'} // <- output format
    // );
    // ```
    DependencyKind::WebWorker => {
      // Use native ES module output if the worker was created with `type: 'module'` and all targets
      // support native module workers. Only do this if parent asset output format is also esmodule so that
      // assets can be shared between workers and the main thread in the global output format.
      let mut output_format = asset_environment.output_format;
      if output_format == OutputFormat::EsModule
        && matches!(
          transformer_dependency.source_type,
          Some(parcel_js_swc_core::SourceType::Module)
        )
        && transformer_config.supports_module_workers
      {
        output_format = OutputFormat::EsModule;
      } else if output_format != OutputFormat::Commonjs {
        output_format = OutputFormat::Global;
      }

      let dependency = Dependency {
        env: Environment {
          context: EnvironmentContext::WebWorker,
          source_type,
          output_format,
          loc: Some(loc.clone()),
          ..asset_environment.clone()
        }
        .into(),
        ..base_dependency
      };

      Ok(DependencyConversionResult::Dependency(dependency))
    }
    DependencyKind::ServiceWorker => {
      let dependency = Dependency {
        env: Environment {
          context: EnvironmentContext::ServiceWorker,
          source_type,
          output_format: OutputFormat::Global,
          loc: Some(loc.clone()),
          ..asset_environment.clone()
        }
        .into(),
        needs_stable_name: true,
        // placeholder: dep.placeholder.map(|s| s.into()),
        ..base_dependency
      };

      Ok(DependencyConversionResult::Dependency(dependency))
    }
    DependencyKind::Worklet => {
      let dependency = Dependency {
        env: Environment {
          context: EnvironmentContext::Worklet,
          source_type: SourceType::Module,
          output_format: OutputFormat::EsModule,
          loc: Some(loc.clone()),
          ..asset_environment.clone()
        }
        .into(),
        // flags: dep_flags,
        // placeholder: dep.placeholder.map(|s| s.into()),
        // promise_symbol: None,
        ..base_dependency
      };

      Ok(DependencyConversionResult::Dependency(dependency))
    }
    DependencyKind::Url => {
      let dependency = Dependency {
        env: asset_environment.clone(),
        bundle_behavior: BundleBehavior::Isolated,
        // flags: dep_flags,
        // placeholder: dep.placeholder.map(|s| s.into()),
        ..base_dependency
      };

      Ok(DependencyConversionResult::Dependency(dependency))
    }
    // File dependencies need no handling and should just register an invalidation request.
    //
    // This is a bit non-uniform, and we might want to just consolidate dependencies as also being
    // non-module file dependencies.
    DependencyKind::File => Ok(DependencyConversionResult::InvalidateOnFileChange(
      PathBuf::from(transformer_dependency.specifier.to_string()),
    )),
    _ => {
      let mut env = asset_environment.clone();
      if transformer_dependency.kind == DependencyKind::DynamicImport {
        // https://html.spec.whatwg.org/multipage/webappapis.html#hostimportmoduledynamically(referencingscriptormodule,-modulerequest,-promisecapability)
        if matches!(
          env.context,
          EnvironmentContext::Worklet | EnvironmentContext::ServiceWorker
        ) {
          let diagnostic = Diagnostic {
            origin: "@parcel/transformer-js".into(),
            message: format!(
              "import() is not allowed in {}.",
              match env.context {
                EnvironmentContext::Worklet => "worklets",
                EnvironmentContext::ServiceWorker => "service workers",
                _ => unreachable!(),
              }
            ),
            ..Default::default()
          };
          // environment_diagnostic(&mut diagnostic, &asset, false);
          return Err(vec![diagnostic]);
        }

        // If all the target engines support dynamic import natively,
        // we can output native ESM if scope hoisting is enabled.
        // Only do this for scripts, rather than modules in the global
        // output format so that assets can be shared between the bundles.
        let mut output_format = env.output_format;
        if env.source_type == SourceType::Script
                    // && env.flags.contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
                    && env.engines.supports(EnvironmentFeature::DynamicImport)
        {
          output_format = OutputFormat::EsModule;
        }

        if env.source_type != SourceType::Module || env.output_format != output_format {
          env = Environment {
            source_type: SourceType::Module,
            output_format,
            loc: Some(loc.clone()),
            ..env.clone()
          }
          .into();
        }
      }

      let mut import_attributes = Vec::new();
      if let Some(attrs) = transformer_dependency.attributes {
        for (key, value) in attrs {
          import_attributes.push(ImportAttribute {
            key: String::from(&*key),
            value,
          });
        }
      }

      let dependency = Dependency {
        env,
        is_optional: transformer_dependency.is_optional,
        is_esm: matches!(
          transformer_dependency.kind,
          DependencyKind::Import | DependencyKind::Export
        ),
        // placeholder: dep.placeholder.map(|s| s.into()),
        // import_attributes,
        ..base_dependency
      };

      Ok(DependencyConversionResult::Dependency(dependency))
    }
  }
}

fn convert_source_type(source_type: &Option<parcel_js_swc_core::SourceType>) -> SourceType {
  if matches!(source_type, Some(parcel_js_swc_core::SourceType::Module)) {
    SourceType::Module
  } else {
    SourceType::Script
  }
}

#[cfg(test)]
mod test {
  use crate::transformer::test_helpers::run_swc_core_transform;

  use super::*;

  #[test]
  fn test_is_re_export_all_symbol() {
    let source = r#"
export * from 'other';
    "#;
    let swc_output = run_swc_core_transform(source);
    let export = &swc_output.hoist_result.unwrap().re_exports[0];
    assert_eq!(is_re_export_all_symbol(export), true);
  }
}
