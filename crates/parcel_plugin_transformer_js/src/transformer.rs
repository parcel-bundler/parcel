use anyhow::{anyhow, Error};
use indexmap::{indexmap, IndexMap};
use std::path::PathBuf;
use swc_core::atoms::Atom;
use swc_core::ecma::atoms::JsWord;

use parcel_core::plugin::PluginContext;
use parcel_core::plugin::TransformerPlugin;
use parcel_core::plugin::{RunTransformContext, TransformResult};
use parcel_core::types::engines::EnvironmentFeature;
use parcel_core::types::{
  Asset, BundleBehavior, Dependency, Environment, EnvironmentContext, FileType, ImportAttribute,
  JSONObject, Location, OutputFormat, Priority, SourceLocation, SourceType, SpecifierType, Symbol,
  SymbolFlags,
};
use parcel_js_swc_core::{Config, DependencyDescriptor, DependencyKind};
use parcel_resolver::{ExportsCondition, IncludeNodeModules};

#[derive(Debug)]
pub struct ParcelTransformerJs {}

impl ParcelTransformerJs {
  pub fn new(_ctx: &PluginContext) -> Self {
    Self {}
  }
}

impl TransformerPlugin for ParcelTransformerJs {
  fn transform(&mut self, context: &mut RunTransformContext) -> Result<TransformResult, Error> {
    let file_system = context.file_system();
    let asset = context.asset();
    let source_code = asset.source_code(file_system)?;

    let transformation_result = parcel_js_swc_core::transform(
      Config {
        filename: asset
          .file_path()
          .to_str()
          .ok_or(anyhow!("Invalid non UTF-8 file-path"))?
          .to_string(),
        code: source_code.bytes().to_vec(),
        ..Config::default()
      },
      None,
    )?;

    let new_code = transformation_result.code;
    let dependencies = transformation_result.dependencies;
    let dependencies: Vec<Dependency> = dependencies
      .iter()
      .map(|dependency| Dependency {
        specifier: dependency.specifier.to_string(),
        ..Dependency::default()
      })
      .collect();

    Ok(TransformResult {})
  }
}

struct Diagnostic;

fn convert_result(
  mut asset: Asset,
  map_buf: Option<&[u8]>,
  config: &Config,
  result: parcel_js_swc_core::TransformResult,
  options: &parcel_core::types::ParcelOptions,
) -> Result<TransformResult, Vec<Diagnostic>> {
  let file_path = asset.file_path().to_path_buf();
  let env = asset.env.clone();
  let asset_id = asset.id();

  asset
    .meta
    .insert("id".into(), format!("{:016x}", asset_id).into());

  if let Some(shebang) = result.shebang {
    asset.meta.insert("interpreter".into(), shebang.into());
  }

  let mut dep_map = IndexMap::new();
  // let mut dep_flags = DependencyFlags::empty();
  // dep_flags.set(
  //   DependencyFlags::HAS_SYMBOLS,
  //   result.hoist_result.is_some() || result.symbol_result.is_some(),
  // );

  let mut invalidate_on_file_change = Vec::new();

  for dep in result.dependencies {
    let loc = convert_loc(file_path.clone(), &dep.loc);
    let placeholder = dep
      .placeholder
      .as_ref()
      .map(|d| d.as_str().into())
      .unwrap_or_else(|| dep.specifier.clone());

    convert_dependency(
      config,
      &file_path,
      &env,
      asset_id,
      &mut dep_map,
      &mut invalidate_on_file_change,
      dep,
      loc,
      placeholder,
    )?;
  }

  if result.needs_esm_helpers {
    let d = Dependency {
      source_asset_id: Some(format!("{:016x}", asset_id)),
      specifier: "@parcel/transformer-js/src/esmodule-helpers.js".into(),
      specifier_type: SpecifierType::Esm,
      source_path: Some(file_path.clone()),
      env: Environment {
        include_node_modules: IncludeNodeModules::Map(
          [("@parcel/transformer-js".to_string(), true)]
            .into_iter()
            .collect(),
        ),
        ..env.clone()
      }
      .into(),
      resolve_from: None,
      // resolve_from: Some(options.core_path.as_path().into()),
      range: None,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      // flags: dep_flags,
      loc: None,
      // placeholder: None,
      target: None,
      // promise_symbol: None,
      symbols: Vec::new(),
      // import_attributes: Vec::new(),
      pipeline: None,
      meta: JSONObject::new(),
      // resolver_meta: JSONObject::new(),
      package_conditions: ExportsCondition::empty(),
      // custom_package_conditions: Vec::new(),
      // TODO:
      is_entry: false,
      needs_stable_name: false,
      is_optional: false,
    };

    dep_map.insert(d.specifier.as_str().into(), d);
  }

  let mut has_cjs_exports = false;
  let mut static_cjs_exports = false;
  let mut should_wrap = false;

  let symbols = &mut asset.symbols;
  if let Some(hoist_result) = result.hoist_result {
    // asset.flags |= AssetFlags::HAS_SYMBOLS;
    symbols.reserve(hoist_result.exported_symbols.len() + hoist_result.re_exports.len() + 1);
    // println!("{:?}", hoist_result);
    for s in &hoist_result.exported_symbols {
      let mut flags = SymbolFlags::empty();
      flags.set(SymbolFlags::IS_ESM, s.is_esm);
      let sym = Symbol {
        exported: s.exported.as_ref().into(),
        local: s.local.as_ref().into(),
        loc: Some(convert_loc(file_path.clone(), &s.loc)),
        flags,
      };
      symbols.push(sym);
    }

    for s in hoist_result.imported_symbols {
      if let Some(dep) = dep_map.get_mut(&s.source) {
        dep.symbols.push(Symbol {
          exported: s.imported.as_ref().into(),
          local: s.local.as_ref().into(),
          loc: Some(convert_loc(file_path.clone(), &s.loc)),
          flags: SymbolFlags::empty(),
        });
      }
    }

    for s in hoist_result.re_exports {
      if let Some(dep) = dep_map.get_mut(&s.source) {
        if &*s.local == "*" && &*s.imported == "*" {
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: Some(convert_loc(file_path.clone(), &s.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
        } else {
          let existing = dep
            .symbols
            .as_slice()
            .iter()
            .find(|sym| sym.exported == &*s.imported);
          let existing_flags = existing.map(|e| e.flags).unwrap_or(SymbolFlags::IS_WEAK);
          let re_export_name = existing
            .map(|sym| sym.local.clone())
            .unwrap_or_else(|| format!("${:016x}$re_export${}", asset_id, s.local).into());
          dep.symbols.push(Symbol {
            exported: s.imported.as_ref().into(),
            local: re_export_name.clone(),
            loc: Some(convert_loc(file_path.clone(), &s.loc)),
            flags: existing_flags & SymbolFlags::IS_WEAK,
          });
          symbols.push(Symbol {
            exported: s.local.as_ref().into(),
            local: re_export_name,
            loc: Some(convert_loc(file_path.clone(), &s.loc)),
            flags: existing_flags & SymbolFlags::IS_WEAK,
          });
        }
      }
    }

    // for specifier in hoist_result.wrapped_requires {
    //   if let Some(dep) = dep_map.get_mut(&specifier) {
    //     dep.flags |= DependencyFlags::SHOULD_WRAP;
    //   }
    // }

    // for (name, specifier) in hoist_result.dynamic_imports {
    //   if let Some(dep) = dep_map.get_mut(&specifier) {
    //     dep.promise_symbol = Some((&*name).into());
    //   }
    // }

    if !hoist_result.self_references.is_empty() {
      for name in hoist_result.self_references {
        // Do not create a self-reference for the `default` symbol unless we have seen an __esModule flag.
        if &*name == "default"
          && !symbols
            .as_slice()
            .iter()
            .any(|s| &*s.exported == "__esModule")
        {
          continue;
        }

        let symbol = symbols
          .iter_mut()
          .find(|s| s.exported.as_str() == name.as_str())
          .unwrap();

        symbol.flags |= SymbolFlags::SELF_REFERENCED;
      }
    }

    // Add * symbol if there are CJS exports, no imports/exports at all
    // (and the asset has side effects), or the asset is wrapped.
    // This allows accessing symbols that don't exist without errors in symbol propagation.
    if (hoist_result.has_cjs_exports
      || (!hoist_result.is_esm
        // && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
        && dep_map.is_empty()
        && hoist_result.exported_symbols.is_empty())
      || hoist_result.should_wrap)
      && !symbols.as_slice().iter().any(|s| s.exported == "*")
    {
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${:016x}$exports", asset_id).into(),
        loc: None,
        flags: SymbolFlags::empty(),
      });
    }

    has_cjs_exports = hoist_result.has_cjs_exports;
    static_cjs_exports = hoist_result.static_cjs_exports;
    should_wrap = hoist_result.should_wrap;
  } else {
    if let Some(symbol_result) = result.symbol_result {
      // asset.flags |= AssetFlags::HAS_SYMBOLS;
      symbols.reserve(symbol_result.exports.len() + 1);
      for sym in &symbol_result.exports {
        let (local, flags) = if let Some(dep) = sym
          .source
          .as_ref()
          .and_then(|source| dep_map.get_mut(source))
        {
          let local = format!("${:016x}${}", dep.id(), sym.local);
          dep.symbols.push(Symbol {
            exported: sym.local.as_ref().into(),
            local: local.clone(),
            loc: Some(convert_loc(file_path.clone(), &sym.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
          (local, SymbolFlags::IS_WEAK)
        } else {
          (format!("${}", sym.local).into(), SymbolFlags::empty())
        };

        symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: Some(convert_loc(file_path.clone(), &sym.loc)),
          flags,
        });
      }

      for sym in symbol_result.imports {
        if let Some(dep) = dep_map.get_mut(&sym.source) {
          dep.symbols.push(Symbol {
            exported: sym.imported.as_ref().into(),
            local: sym.local.as_ref().into(),
            loc: Some(convert_loc(file_path.clone(), &sym.loc)),
            flags: SymbolFlags::empty(),
          });
        }
      }

      for sym in symbol_result.exports_all {
        if let Some(dep) = dep_map.get_mut(&sym.source) {
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: Some(convert_loc(file_path.clone(), &sym.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
        }
      }

      // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if symbol_result.has_cjs_exports
        || (!symbol_result.is_esm
          // && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
          && dep_map.is_empty()
          && symbol_result.exports.is_empty())
        || (symbol_result.should_wrap && !symbols.as_slice().iter().any(|s| s.exported == "*"))
      {
        symbols.push(Symbol {
          exported: "*".into(),
          local: format!("${:016x}$exports", asset_id).into(),
          loc: None,
          flags: SymbolFlags::empty(),
        });
      }
    } else {
      // If the asset is wrapped, add * as a fallback
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${:016x}$exports", asset_id).into(),
        loc: None,
        flags: SymbolFlags::empty(),
      });
    }

    // For all other imports and requires, mark everything as imported (this covers both dynamic
    // imports and non-top-level requires.)
    for dep in dep_map.values_mut() {
      if dep.symbols.is_empty() {
        dep.symbols.push(Symbol {
          exported: "*".into(),
          local: "".into(), // format!("${}$", dep.placeholder.as_ref().unwrap_or(&dep.specifier)).into(),
          flags: SymbolFlags::empty(),
          loc: None,
        });
      }
    }
  }

  // asset.flags.set(
  //   AssetFlags::HAS_NODE_REPLACEMENTS,
  //   result.has_node_replacements,
  // );
  // asset
  //     .flags
  //     .set(AssetFlags::IS_CONSTANT_MODULE, result.is_constant_module);
  // asset
  //     .flags
  //     .set(AssetFlags::HAS_CJS_EXPORTS, has_cjs_exports);
  // asset
  //     .flags
  //     .set(AssetFlags::STATIC_EXPORTS, static_cjs_exports);
  // asset.flags.set(AssetFlags::SHOULD_WRAP, should_wrap);

  if asset.unique_key.is_none() {
    asset.unique_key = Some(format!("{:016x}", asset_id));
  }
  asset.asset_type = FileType::Js;

  Ok(TransformResult {
    // asset,
    // code: result.code,
    // dependencies: dep_map.into_values().collect(),

    // code: result.code,
    // map: result.map,
    // shebang: result.shebang,
    // dependencies: deps,
    // diagnostics: result.diagnostics,
    // used_env: result.used_env.into_iter().map(|v| v.to_string()).collect(),
    // invalidate_on_file_change,
  })
}

fn convert_dependency(
  config: &Config,
  file_path: &PathBuf,
  env: &Environment,
  asset_id: u64,
  dep_map: &mut IndexMap<JsWord, Dependency>,
  invalidate_on_file_change: &mut Vec<String>,
  dep: DependencyDescriptor,
  loc: SourceLocation,
  placeholder: Atom,
) -> Result<(), Vec<Diagnostic>> {
  match dep.kind {
    DependencyKind::WebWorker => {
      // Use native ES module output if the worker was created with `type: 'module'` and all targets
      // support native module workers. Only do this if parent asset output format is also esmodule so that
      // assets can be shared between workers and the main thread in the global output format.
      let mut output_format = env.output_format;
      if output_format == OutputFormat::EsModule
        && matches!(
          dep.source_type,
          Some(parcel_js_swc_core::SourceType::Module)
        )
        && config.supports_module_workers
      {
        output_format = OutputFormat::EsModule;
      } else if output_format != OutputFormat::Commonjs {
        output_format = OutputFormat::Global;
      }

      let d = Dependency {
        source_asset_id: Some(format!("{:016x}", asset_id)),
        specifier: dep.specifier.as_ref().into(),
        specifier_type: SpecifierType::Url,
        source_path: Some(file_path.clone()),
        env: Environment {
          context: EnvironmentContext::WebWorker,
          source_type: if matches!(
            dep.source_type,
            Some(parcel_js_swc_core::SourceType::Module)
          ) {
            SourceType::Module
          } else {
            SourceType::Script
          },
          output_format,
          loc: Some(loc.clone()),
          ..env.clone()
        }
        .into(),
        resolve_from: None,
        range: None,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // flags: dep_flags | DependencyFlags::IS_WEBWORKER,
        loc: Some(loc.clone()),
        // placeholder: dep.placeholder.map(|s| s.into()),
        target: None,
        symbols: Vec::new(),
        // promise_symbol: None,
        // import_attributes: Vec::new(),
        pipeline: None,
        meta: JSONObject::new(),
        // resolver_meta: JSONObject::new(),
        package_conditions: ExportsCondition::empty(),
        // custom_package_conditions: Vec::new(),
        ..Dependency::default()
      };

      dep_map.insert(placeholder, d);
    }
    DependencyKind::ServiceWorker => {
      let d = Dependency {
        source_asset_id: Some(format!("{:016x}", asset_id)),
        specifier: dep.specifier.as_ref().into(),
        specifier_type: SpecifierType::Url,
        source_path: Some(file_path.clone()),
        env: Environment {
          context: EnvironmentContext::ServiceWorker,
          source_type: if matches!(
            dep.source_type,
            Some(parcel_js_swc_core::SourceType::Module)
          ) {
            SourceType::Module
          } else {
            SourceType::Script
          },
          output_format: OutputFormat::Global,
          loc: Some(loc.clone()),
          ..env.clone()
        }
        .into(),
        resolve_from: None,
        range: None,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // flags: dep_flags | DependencyFlags::NEEDS_STABLE_NAME,
        loc: Some(loc.clone()),
        // placeholder: dep.placeholder.map(|s| s.into()),
        target: None,
        symbols: Vec::new(),
        // promise_symbol: None,
        // import_attributes: Vec::new(),
        pipeline: None,
        meta: JSONObject::new(),
        // resolver_meta: JSONObject::new(),
        package_conditions: ExportsCondition::empty(),
        // custom_package_conditions: Vec::new(),
        ..Dependency::default()
      };

      dep_map.insert(placeholder, d);
    }
    DependencyKind::Worklet => {
      let d = Dependency {
        source_asset_id: Some(format!("{:016x}", asset_id)),
        specifier: dep.specifier.as_ref().into(),
        specifier_type: SpecifierType::Url,
        source_path: Some(file_path.clone()),
        env: Environment {
          context: EnvironmentContext::Worklet,
          source_type: SourceType::Module,
          output_format: OutputFormat::EsModule,
          loc: Some(loc.clone()),
          ..env.clone()
        }
        .into(),
        resolve_from: None,
        range: None,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::None,
        // flags: dep_flags,
        loc: Some(loc.clone()),
        // placeholder: dep.placeholder.map(|s| s.into()),
        target: None,
        symbols: Vec::new(),
        // promise_symbol: None,
        // import_attributes: Vec::new(),
        pipeline: None,
        meta: JSONObject::new(),
        // resolver_meta: JSONObject::new(),
        package_conditions: ExportsCondition::empty(),
        // custom_package_conditions: Vec::new(),
        ..Dependency::default()
      };

      dep_map.insert(placeholder, d);
    }
    DependencyKind::Url => {
      let d = Dependency {
        source_asset_id: Some(format!("{:016x}", asset_id)),
        specifier: dep.specifier.as_ref().into(),
        specifier_type: SpecifierType::Url,
        source_path: Some(file_path.clone()),
        env: env.clone(),
        resolve_from: None,
        range: None,
        priority: Priority::Lazy,
        bundle_behavior: BundleBehavior::Isolated,
        // flags: dep_flags,
        loc: Some(loc.clone()),
        // placeholder: dep.placeholder.map(|s| s.into()),
        target: None,
        symbols: Vec::new(),
        // promise_symbol: None,
        // import_attributes: Vec::new(),
        pipeline: None,
        meta: JSONObject::new(),
        // resolver_meta: JSONObject::new(),
        package_conditions: ExportsCondition::empty(),
        // custom_package_conditions: Vec::new(),
        ..Dependency::default()
      };

      dep_map.insert(placeholder, d);
    }
    DependencyKind::File => {
      invalidate_on_file_change.push(dep.specifier.to_string());
    }
    _ => {
      // let mut flags = dep_flags;
      // flags.set(DependencyFlags::OPTIONAL, dep.is_optional);
      // flags.set(
      //   DependencyFlags::IS_ESM,
      //   matches!(dep.kind, DependencyKind::Import | DependencyKind::Export),
      // );

      let mut env = env.clone();
      if dep.kind == DependencyKind::DynamicImport {
        // https://html.spec.whatwg.org/multipage/webappapis.html#hostimportmoduledynamically(referencingscriptormodule,-modulerequest,-promisecapability)
        if matches!(
          env.context,
          EnvironmentContext::Worklet | EnvironmentContext::ServiceWorker
        ) {
          let mut diagnostic = Diagnostic {
            // origin: Some("@parcel/transformer-js".into()),
            // message: format!(
            //   "import() is not allowed in {}.",
            //   match env.context {
            //     EnvironmentContext::Worklet => "worklets",
            //     EnvironmentContext::ServiceWorker => "service workers",
            //     _ => unreachable!(),
            //   }
            // ),
            // code_frames: vec![CodeFrame {
            //   file_path: Some(asset.file_path),
            //   code: None,
            //   language: None,
            //   code_highlights: vec![CodeHighlight::from_loc(
            //     &convert_loc(asset.file_path, &dep.loc),
            //     None,
            //   )],
            // }],
            // hints: vec!["Try using a static `import`.".into()],
            // severity: DiagnosticSeverity::Error,
            // documentation_url: None,
          };
          // environment_diagnostic(&mut diagnostic, &asset, false);
          return Err(vec![diagnostic]);
        }

        // If all of the target engines support dynamic import natively,
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

      // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
      let is_helper = dep.is_helper
        && !(dep.specifier.ends_with("/jsx-runtime")
          || dep.specifier.ends_with("/jsx-dev-runtime"));
      if is_helper {
        // && !env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
        env = Environment {
          include_node_modules: IncludeNodeModules::Bool(true),
          ..env.clone()
        }
        .into();
      }

      // Add required version range for helpers.
      let mut range = None;
      let mut resolve_from = None;
      if is_helper {
        // TODO: get versions from package.json? Can we do it at compile time?
        if dep.specifier.starts_with("@swc/helpers") {
          range = Some("^0.5.0".into());
        } else if dep.specifier.starts_with("regenerator-runtime") {
          range = Some("^0.13.7".into());
        }

        // resolve_from = Some(options.core_path.as_path().into());
      }

      let mut import_attributes = Vec::new();
      if let Some(attrs) = dep.attributes {
        for (key, value) in attrs {
          import_attributes.push(ImportAttribute {
            key: String::from(&*key),
            value,
          });
        }
      }

      let d = Dependency {
        source_asset_id: Some(format!("{:016x}", asset_id)),
        specifier: dep.specifier.as_ref().into(),
        specifier_type: match dep.kind {
          parcel_js_swc_core::DependencyKind::Require => SpecifierType::CommonJS,
          _ => SpecifierType::Esm,
        },
        source_path: Some(file_path.clone()),
        env,
        resolve_from,
        range,
        priority: match dep.kind {
          parcel_js_swc_core::DependencyKind::DynamicImport => Priority::Lazy,
          _ => Priority::Sync,
        },
        bundle_behavior: BundleBehavior::None,
        // flags,
        loc: Some(loc.clone()),
        // placeholder: dep.placeholder.map(|s| s.into()),
        target: None,
        symbols: Vec::new(),
        // promise_symbol: None,
        // import_attributes,
        pipeline: None,
        meta: JSONObject::new(),
        // resolver_meta: JSONObject::new(),
        package_conditions: ExportsCondition::empty(),
        // custom_package_conditions: Vec::new(),

        // TODO:
        is_entry: false,
        needs_stable_name: false,
        is_optional: false,
      };

      dep_map.insert(placeholder, d);
    }
  }
  Ok(())
}

fn convert_loc(
  file_path: PathBuf,
  loc: &parcel_js_swc_core::SourceLocation,
  // map: &mut Option<SourceMap>,
) -> SourceLocation {
  let mut loc = SourceLocation {
    file_path,
    start: Location {
      line: loc.start_line as u32, // + (asset.meta.startLine ?? 1) - 1
      column: loc.start_col as u32,
    },
    end: Location {
      line: loc.end_line as u32,
      column: loc.end_col as u32,
    },
  };

  // if let Some(map) = map {
  // remap_source_location(&mut loc, map);
  // }

  loc
}
