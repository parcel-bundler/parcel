use std::path::{Path, PathBuf};
use std::rc::Rc;

use anyhow::{anyhow, Error};
use indexmap::IndexMap;
use swc_core::atoms::Atom;

use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::{RunTransformContext, TransformResult, TransformationInput};
use parcel_core::types::engines::EnvironmentFeature;
use parcel_core::types::{
  Asset, BundleBehavior, Code, Dependency, Diagnostic, Environment, EnvironmentContext, FileType,
  ImportAttribute, Location, OutputFormat, ParcelOptions, Priority, SourceLocation, SourceType,
  SpecifierType, Symbol,
};
use parcel_resolver::IncludeNodeModules;

/// This is a rust only `TransformerPlugin` implementation for JS assets that goes through the
/// default SWC transformer.
///
/// The transformer is part of the `AssetRequest` and is responsible for:
///
/// * Parsing a JS/TS file
/// * Transforming the file using SWC
/// * Analyzing all its `require`/`import`/`export` statements and returning lists of found
///  `Dependency` as well as exported, imported and re-exported symbols (as `Symbol`, usually
///   mapping to a mangled name that the SWC transformer replaced in the source file + the source
///   module and the source name that has been imported)
#[derive(Debug)]
pub struct ParcelJsTransformerPlugin {}

impl ParcelJsTransformerPlugin {
  pub fn new() -> Self {
    Self {}
  }
}

impl TransformerPlugin for ParcelJsTransformerPlugin {
  /// This does a lot of equivalent work to `JSTransformer::transform` in
  /// `packages/transformers/js`
  fn transform(
    &mut self,
    context: &mut RunTransformContext,
    input: TransformationInput,
  ) -> Result<TransformResult, Error> {
    let file_system = context.file_system();
    let source_code = input.read_code(file_system)?;

    let transformation_result = parcel_js_swc_core::transform(
      parcel_js_swc_core::Config {
        filename: input
          .file_path()
          .to_str()
          .ok_or_else(|| anyhow!("Invalid non UTF-8 file-path"))?
          .to_string(),
        code: source_code.bytes().to_vec(),
        source_type: parcel_js_swc_core::SourceType::Module,
        ..parcel_js_swc_core::Config::default()
      },
      None,
    )?;

    // TODO handle errors properly
    if let Some(errors) = transformation_result.diagnostics {
      return Err(anyhow!(format!("{:#?}", errors)));
    }

    let asset = Asset::new_empty(input.file_path().to_path_buf(), source_code);
    let config = parcel_js_swc_core::Config::default();
    let options = ParcelOptions::default();
    let result = convert_result(asset, &config, transformation_result, &options)
      // TODO handle errors properly
      .map_err(|_err| anyhow!("Failed to transform"))?;

    Ok(result)
  }
}

fn convert_result(
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
  asset.code = Rc::new(Code::from(result_source_code_string));

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
fn is_re_export_all_symbol(symbol: &parcel_js_swc_core::ImportedSymbol) -> bool {
  symbol.local == "*" && symbol.imported == "*"
}

/// Convert the SWC transformer dependency descriptors into the core `Dependency` type.
///
/// Collect the dependencies by their local scope-hoisting names that the transformer has output
/// onto the file. This returns a map of mangled JS name (that the transformer generated) to the
/// dependency value.
///
/// This will be used to find dependencies corresponding to imported symbols' `local` mangled names.
fn convert_dependencies(
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

fn make_export_star_symbol(asset_id: u64) -> Symbol {
  Symbol {
    exported: "*".into(),
    // This is the mangled exports name
    local: format!("${:016x}$exports", asset_id).into(),
    loc: None,
    ..Default::default()
  }
}

/// Convert `CollectImportedSymbol`, `ImportedSymbol` and into `Symbol`
macro_rules! convert_symbol {
  ($asset_file_path: ident, $symbol: ident) => {
    Symbol {
      exported: $symbol.imported.as_ref().into(),
      local: $symbol.local.as_ref().into(),
      loc: Some(convert_loc($asset_file_path.to_owned(), &$symbol.loc)),
      ..Default::default()
    }
  };
}

/// Convert from `[CollectImportedSymbol]` to `[Symbol]`
fn transformer_collect_imported_symbol_to_symbol(
  asset_file_path: &Path,
  symbol: &parcel_js_swc_core::CollectImportedSymbol,
) -> Symbol {
  convert_symbol!(asset_file_path, symbol)
}

/// Convert from `[ImportedSymbol]` to `[Symbol]`
///
/// `ImportedSymbol` corresponds to `x`, `y` in `import { x, y } from 'other';`
fn transformer_imported_symbol_to_symbol(
  asset_file_path: &Path,
  symbol: &parcel_js_swc_core::ImportedSymbol,
) -> Symbol {
  convert_symbol!(asset_file_path, symbol)
}

/// Convert from `[ExportedSymbol]` to `[Symbol]`
fn transformer_exported_symbol_into_symbol(
  asset_file_path: &PathBuf,
  symbol: &parcel_js_swc_core::ExportedSymbol,
) -> Symbol {
  Symbol {
    exported: symbol.exported.as_ref().into(),
    local: symbol.local.as_ref().into(),
    loc: Some(convert_loc(asset_file_path.to_owned(), &symbol.loc)),
    is_esm_export: symbol.is_esm,
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
  let source_type = convert_source_type(&transformer_dependency);
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

fn convert_priority(transformer_dependency: &parcel_js_swc_core::DependencyDescriptor) -> Priority {
  use parcel_js_swc_core::DependencyKind;

  match transformer_dependency.kind {
    DependencyKind::DynamicImport => Priority::Lazy,
    DependencyKind::WebWorker => Priority::Lazy,
    DependencyKind::ServiceWorker => Priority::Lazy,
    DependencyKind::Worklet => Priority::Lazy,
    DependencyKind::Url => Priority::Lazy,
    DependencyKind::Import => Priority::Sync,
    DependencyKind::Export => Priority::Sync,
    DependencyKind::Require => Priority::Sync,
    DependencyKind::File => Priority::Sync,
  }
}

fn convert_specifier_type(
  transformer_dependency: &parcel_js_swc_core::DependencyDescriptor,
) -> SpecifierType {
  use parcel_js_swc_core::DependencyKind;

  match transformer_dependency.kind {
    DependencyKind::Require => SpecifierType::CommonJS,
    DependencyKind::Import => SpecifierType::Esm,
    DependencyKind::Export => SpecifierType::Esm,
    DependencyKind::DynamicImport => SpecifierType::Esm,
    DependencyKind::WebWorker => SpecifierType::Url,
    DependencyKind::ServiceWorker => SpecifierType::Url,
    DependencyKind::Worklet => SpecifierType::Url,
    DependencyKind::Url => SpecifierType::Url,
    DependencyKind::File => SpecifierType::Custom,
  }
}

fn convert_source_type(
  transformer_dependency: &parcel_js_swc_core::DependencyDescriptor,
) -> SourceType {
  if matches!(
    transformer_dependency.source_type,
    Some(parcel_js_swc_core::SourceType::Module)
  ) {
    SourceType::Module
  } else {
    SourceType::Script
  }
}

fn convert_loc(file_path: PathBuf, loc: &parcel_js_swc_core::SourceLocation) -> SourceLocation {
  SourceLocation {
    file_path,
    start: Location {
      line: loc.start_line as u32,
      column: loc.start_col as u32,
    },
    end: Location {
      line: loc.end_line as u32,
      column: loc.end_col as u32,
    },
  }
}

#[cfg(test)]
mod test {
  use std::path::PathBuf;
  use std::rc::Rc;
  use std::sync::Arc;

  use parcel_core::plugin::{
    RunTransformContext, TransformResult, TransformationInput, TransformerPlugin,
  };
  use parcel_core::types::{
    Asset, Code, Dependency, FileType, Location, SourceLocation, SpecifierType, Symbol,
  };
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use parcel_js_swc_core::{Config, DependencyKind};

  use crate::ParcelJsTransformerPlugin;

  use super::*;

  fn empty_asset() -> Asset {
    Asset {
      asset_type: FileType::Js,
      ..Default::default()
    }
  }

  #[test]
  fn test_asset_id_is_stable() {
    let source_code = Rc::new(Code::from(String::from("function hello() {}")));
    let asset_1 = Asset::new_empty("mock_path".into(), source_code.clone());
    let asset_2 = Asset::new_empty("mock_path".into(), source_code);
    // This nº should not change across runs/compilation
    assert_eq!(asset_1.id(), 4127533076662631483);
    assert_eq!(asset_1.id(), asset_2.id());
  }

  #[test]
  fn test_transformer_on_noop_asset() {
    let source_code = Rc::new(Code::from(String::from("function hello() {}")));
    let target_asset = Asset::new_empty("mock_path".into(), source_code);
    let asset_id = target_asset.id();
    let result = run_test(target_asset).unwrap();

    assert_eq!(
      result,
      TransformResult {
        asset: Asset {
          file_path: "mock_path".into(),
          asset_type: FileType::Js,
          // SWC inserts a newline here
          code: Rc::new(Code::from(String::from("function hello() {}\n"))),
          symbols: vec![],
          has_symbols: true,
          unique_key: Some(format!("{:016x}", asset_id)),
          ..empty_asset()
        },
        dependencies: vec![],
        invalidate_on_file_change: vec![]
      }
    );
  }

  #[test]
  fn test_transformer_on_asset_that_requires_other() {
    let source_code = Rc::new(Code::from(String::from(
      r#"
const x = require('other');
exports.hello = function() {};
    "#,
    )));
    let target_asset = Asset::new_empty("mock_path.js".into(), source_code);
    let asset_id = target_asset.id();
    let result = run_test(target_asset).unwrap();

    let expected_dependencies = vec![Dependency {
      loc: Some(SourceLocation {
        file_path: PathBuf::from("mock_path.js"),
        start: Location {
          line: 2,
          column: 19,
        },
        end: Location {
          line: 2,
          column: 26,
        },
      }),
      source_asset_id: Some(format!("{:016x}", asset_id)),
      source_path: Some(PathBuf::from("mock_path.js")),
      specifier: String::from("other"),
      specifier_type: SpecifierType::CommonJS,
      symbols: vec![Symbol {
        exported: String::from("*"),
        loc: None,
        local: String::from("$other$"),
        ..Symbol::default()
      }],
      ..Default::default()
    }];
    assert_eq!(result.dependencies, expected_dependencies);
    assert_eq!(
      result,
      TransformResult {
        asset: Asset {
          file_path: "mock_path.js".into(),
          asset_type: FileType::Js,
          // SWC inserts a newline here
          code: Rc::new(Code::from(String::from(
            "const x = require(\"e83f3db3d6f57ea6\");\nexports.hello = function() {};\n"
          ))),
          symbols: vec![
            Symbol {
              exported: String::from("hello"),
              loc: Some(SourceLocation {
                file_path: PathBuf::from("mock_path.js"),
                start: Location { line: 3, column: 9 },
                end: Location {
                  line: 3,
                  column: 14
                }
              }),
              local: String::from("$hello"),
              ..Default::default()
            },
            Symbol {
              exported: String::from("*"),
              loc: Some(SourceLocation {
                file_path: PathBuf::from("mock_path.js"),
                start: Location { line: 1, column: 1 },
                end: Location { line: 1, column: 1 }
              }),
              local: String::from("$_"),
              ..Default::default()
            },
            Symbol {
              exported: String::from("*"),
              loc: None,
              local: format!("${:016x}$exports", asset_id),
              ..Default::default()
            }
          ],
          has_symbols: true,
          unique_key: Some(format!("{:016x}", asset_id)),
          ..empty_asset()
        },
        dependencies: expected_dependencies,
        invalidate_on_file_change: vec![]
      }
    );
  }

  #[test]
  fn test_is_re_export_all_symbol() {
    let source = r#"
export * from 'other';
    "#;
    let swc_output = parcel_js_swc_core::transform(make_test_swc_config(source), None).unwrap();
    let export = &swc_output.hoist_result.unwrap().re_exports[0];
    assert_eq!(is_re_export_all_symbol(export), true);
  }

  #[test]
  fn test_convert_transformer_imported_symbol_to_symbol() {
    let source = r#"
import {x} from 'other';
export function test() {
  return x;
}
    "#;
    let swc_output = parcel_js_swc_core::transform(make_test_swc_config(source), None).unwrap();
    let import = &swc_output.hoist_result.unwrap().imported_symbols[0];
    let output = transformer_imported_symbol_to_symbol(Path::new("path"), import);

    assert_eq!(
      output,
      Symbol {
        local: "$$import$70a00e0a8474f72a$d141bba7fdc215a3".into(),
        exported: "x".to_string(),
        loc: Some(SourceLocation {
          file_path: PathBuf::from("path"),
          start: Location { line: 2, column: 9 },
          end: Location {
            line: 2,
            column: 10
          }
        }),
        is_weak: false,
        is_esm_export: false,
        self_referenced: false,
      }
    );
  }

  struct DependencyKindTestCase {
    source: &'static str,
    dependency_kind: DependencyKind,
    priority: Priority,
  }
  fn get_dependency_kind_test_cases() -> Vec<DependencyKindTestCase> {
    vec![
      DependencyKindTestCase {
        source: r#"import {x} from 'other';"#,
        dependency_kind: DependencyKind::Import,
        priority: Priority::Sync,
      },
      DependencyKindTestCase {
        source: r#"import('other')"#,
        dependency_kind: DependencyKind::DynamicImport,
        priority: Priority::Lazy,
      },
      DependencyKindTestCase {
        source: r#"export {x} from 'other';"#,
        dependency_kind: DependencyKind::Export,
        priority: Priority::Sync,
      },
      DependencyKindTestCase {
        source: r#"const {x} = require('other');"#,
        dependency_kind: DependencyKind::Require,
        priority: Priority::Sync,
      },
      DependencyKindTestCase {
        source: r#"new Worker(new URL('other', import.meta.url), {type: 'module'})"#,
        dependency_kind: DependencyKind::WebWorker,
        priority: Priority::Lazy,
      },
      DependencyKindTestCase {
        source: r#"navigator.serviceWorker.register(new URL('./dependency', import.meta.url), {type: 'module'});"#,
        dependency_kind: DependencyKind::ServiceWorker,
        priority: Priority::Lazy,
      },
      DependencyKindTestCase {
        source: r#"CSS.paintWorklet.addModule(new URL('other', import.meta.url));"#,
        dependency_kind: DependencyKind::Worklet,
        priority: Priority::Lazy,
      },
      DependencyKindTestCase {
        source: r#"
  let img = document.createElement('img');
  img.src = new URL('hero.jpg', import.meta.url);
  document.body.appendChild(img);
      "#,
        dependency_kind: DependencyKind::Url,
        priority: Priority::Lazy,
      },
      // This test-case can't be written right now because in order to parse inline-fs
      // declarations, parcel needs to canonicalize paths, meaning that it does not work
      // unless the source/project and read files exist on disk.
      //
      // DependencyKindTestCase {
      //   source: r#"
      // import fs from "fs";
      // import path from "path";
      // const data = fs.readFileSync(path.join(__dirname, "data.json"), "utf8");
      //   "#,
      //   dependency_kind: DependencyKind::File,
      //   priority: Priority::Sync,
      // },
    ]
  }

  #[test]
  fn test_convert_priority() {
    let get_dependency = |source| {
      let swc_output = parcel_js_swc_core::transform(make_test_swc_config(source), None).unwrap();
      println!("{:?}", swc_output.dependencies);
      swc_output.dependencies.last().unwrap().clone()
    };
    for DependencyKindTestCase {
      dependency_kind,
      priority,
      source,
    } in &get_dependency_kind_test_cases()
    {
      let dependency = get_dependency(source);
      assert_eq!(&dependency.kind, dependency_kind);
      assert_eq!(convert_priority(&dependency), *priority);
    }
  }

  fn make_test_swc_config(source: &str) -> Config {
    Config {
      source_type: parcel_js_swc_core::SourceType::Module,
      is_browser: true,
      filename: "something/file.js".to_string(),
      inline_fs: true,
      code: source.as_bytes().to_vec(),
      scope_hoist: true,
      ..Default::default()
    }
  }

  fn run_test(asset: Asset) -> anyhow::Result<TransformResult> {
    let file_system = Arc::new(InMemoryFileSystem::default());
    let mut context = RunTransformContext::new(file_system);
    let mut transformer = ParcelJsTransformerPlugin::new();
    let input = TransformationInput::Asset(asset);

    let result = transformer.transform(&mut context, input)?;
    Ok(result)
  }
}
