use std::collections::HashMap;
use std::path::PathBuf;

use indexmap::{indexmap, IndexMap};
use parcel_js_swc_core::{
  CodeHighlight, Config, DependencyKind, Diagnostic, TransformResult, Version, Versions,
};

use crate::requests::asset_request::{AssetRequestResult, Transformer};
use crate::types::{
  Asset, AssetFlags, AssetType, BundleBehavior, Dependency, DependencyFlags, Environment,
  EnvironmentContext, EnvironmentFlags, ExportsCondition, ImportAttribute, IncludeNodeModules,
  Location, OutputFormat, Priority, SourceLocation, SourceType, SpecifierType, Symbol, SymbolFlags,
};

pub struct JsTransformer;

impl Transformer for JsTransformer {
  fn transform(
    &self,
    asset: &Asset,
    code: Vec<u8>,
    _farm: &crate::worker_farm::WorkerFarm,
  ) -> AssetRequestResult {
    let config = config(&asset, code);
    let res = parcel_js_swc_core::transform(&config, None).unwrap();
    convert_result(asset.clone(), None, &config, res)
  }
}

#[inline]
fn config<'a>(asset: &Asset, code: Vec<u8>) -> Config {
  let mut targets = None;
  if asset.env.context.is_electron() {
    if let Some(electron) = asset
      .env
      .engines
      .electron
      .as_ref()
      .and_then(|v| node_semver::Range::parse(v.as_str()).ok())
      .and_then(|r| r.min_version())
    {
      targets = Some(Versions {
        electron: Some(Version {
          major: electron.major as u32,
          minor: electron.minor as u32,
          patch: electron.patch as u32,
        }),
        ..Default::default()
      });
    }
  } else if asset.env.context.is_browser() && !asset.env.engines.browsers.is_empty() {
    // TODO: parse_versions should ideally take a reference to a slice not a Vec
    if let Some(browsers) = Versions::parse_versions(asset.env.engines.browsers.clone()).ok() {
      targets = Some(browsers);
    }
  } else if asset.env.context.is_node() {
    if let Some(node) = asset
      .env
      .engines
      .node
      .as_ref()
      .and_then(|v| node_semver::Range::parse(v.as_str()).ok())
      .and_then(|r| r.min_version())
    {
      targets = Some(Versions {
        node: Some(Version {
          major: node.major as u32,
          minor: node.minor as u32,
          patch: node.patch as u32,
        }),
        ..Default::default()
      });
    }
  }

  Config {
    filename: asset.file_path.clone(),
    code,
    module_id: asset.id.clone(),
    project_root: "/".into(), // TODO
    replace_env: !asset.env.context.is_node(),
    env: HashMap::new(), // TODO
    inline_fs: true,     // TODO
    insert_node_globals: !asset.env.context.is_node()
      && asset.env.source_type != SourceType::Script,
    node_replacer: asset.env.context.is_node(),
    is_browser: asset.env.context.is_browser(),
    is_worker: asset.env.context.is_worker(),
    is_type_script: matches!(asset.asset_type, AssetType::Ts | AssetType::Tsx),
    is_jsx: false,                      // TODO
    jsx_pragma: None,                   // TODO
    jsx_pragma_frag: None,              // TODO
    automatic_jsx_runtime: false,       // TODO
    jsx_import_source: None,            // TODO
    decorators: false,                  // TODO
    use_define_for_class_fields: false, // TODO
    is_development: true,               // TODO db.options.mode == BuildMode::Development,
    react_refresh: false,               // TODO
    targets,
    source_maps: asset.env.source_map.is_some(),
    scope_hoist: asset
      .env
      .flags
      .contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
      && asset.env.source_type != SourceType::Script,
    source_type: match asset.env.source_type {
      SourceType::Script => parcel_js_swc_core::SourceType::Script,
      _ => parcel_js_swc_core::SourceType::Module,
    },
    supports_module_workers: true, // TODO
    is_library: asset.env.flags.contains(EnvironmentFlags::IS_LIBRARY),
    is_esm_output: asset.env.output_format == OutputFormat::Esmodule,
    trace_bailouts: false, // TODO db.options.log_level == LogLevel::Verbose,
    is_swc_helpers: asset
      .file_path
      .to_str()
      .unwrap_or("")
      .contains("@swc/helpers"),
    standalone: asset
      .query
      .as_ref()
      .map_or(false, |q| q.contains("standalone=true")), // TODO: use a real parser
    inline_constants: false,
  }
}

fn convert_result(
  mut asset: Asset,
  map_buf: Option<&[u8]>,
  config: &Config,
  mut result: TransformResult,
) -> AssetRequestResult {
  let file_path = asset.file_path.clone();
  let env = asset.env.clone();

  // let mut map = if let Some(buf) = map_buf {
  //   SourceMap::from_buffer(&db.options.project_root, buf).ok()
  // } else {
  //   None
  // };
  // let map = None;

  let mut dep_map = IndexMap::new();
  let mut dep_flags = DependencyFlags::empty();
  dep_flags.set(
    DependencyFlags::HAS_SYMBOLS,
    result.hoist_result.is_some() || result.symbol_result.is_some(),
  );

  let mut invalidate_on_file_change = Vec::new();

  for dep in result.dependencies {
    let loc = convert_loc(file_path.clone(), &dep.loc);
    let placeholder = dep
      .placeholder
      .as_ref()
      .map(|d| d.as_str().into())
      .unwrap_or_else(|| dep.specifier.clone());

    match dep.kind {
      DependencyKind::WebWorker => {
        // Use native ES module output if the worker was created with `type: 'module'` and all targets
        // support native module workers. Only do this if parent asset output format is also esmodule so that
        // assets can be shared between workers and the main thread in the global output format.
        let mut output_format = env.output_format;
        if output_format == OutputFormat::Esmodule
          && matches!(
            dep.source_type,
            Some(parcel_js_swc_core::SourceType::Module)
          )
          && config.supports_module_workers
        {
          output_format = OutputFormat::Esmodule;
        } else if output_format != OutputFormat::Commonjs {
          output_format = OutputFormat::Global;
        }

        let d = Dependency {
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
          },
          resolve_from: None,
          range: None,
          priority: Priority::Lazy,
          bundle_behavior: BundleBehavior::None,
          flags: dep_flags | DependencyFlags::IS_WEBWORKER,
          loc: Some(loc.clone()),
          placeholder: dep.placeholder.map(|s| s.into()),
          target: None,
          symbols: Vec::new(),
          promise_symbol: None,
          import_attributes: Vec::new(),
          pipeline: None,
          meta: None,
          resolver_meta: None,
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
      DependencyKind::ServiceWorker => {
        let d = Dependency {
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
          },
          resolve_from: None,
          range: None,
          priority: Priority::Lazy,
          bundle_behavior: BundleBehavior::None,
          flags: dep_flags | DependencyFlags::NEEDS_STABLE_NAME,
          loc: Some(loc.clone()),
          placeholder: dep.placeholder.map(|s| s.into()),
          target: None,
          symbols: Vec::new(),
          promise_symbol: None,
          import_attributes: Vec::new(),
          pipeline: None,
          meta: None,
          resolver_meta: None,
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
      DependencyKind::Worklet => {
        let d = Dependency {
          specifier: dep.specifier.as_ref().into(),
          specifier_type: SpecifierType::Url,
          source_path: Some(file_path.clone()),
          env: Environment {
            context: EnvironmentContext::Worklet,
            source_type: SourceType::Module,
            output_format: OutputFormat::Esmodule,
            loc: Some(loc.clone()),
            ..env.clone()
          },
          resolve_from: None,
          range: None,
          priority: Priority::Lazy,
          bundle_behavior: BundleBehavior::None,
          flags: dep_flags,
          loc: Some(loc.clone()),
          placeholder: dep.placeholder.map(|s| s.into()),
          target: None,
          symbols: Vec::new(),
          promise_symbol: None,
          import_attributes: Vec::new(),
          pipeline: None,
          meta: None,
          resolver_meta: None,
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
      DependencyKind::Url => {
        let d = Dependency {
          specifier: dep.specifier.as_ref().into(),
          specifier_type: SpecifierType::Url,
          source_path: Some(file_path.clone()),
          env: env.clone(),
          resolve_from: None,
          range: None,
          priority: Priority::Lazy,
          bundle_behavior: BundleBehavior::Isolated,
          flags: dep_flags,
          loc: Some(loc.clone()),
          placeholder: dep.placeholder.map(|s| s.into()),
          target: None,
          symbols: Vec::new(),
          promise_symbol: None,
          import_attributes: Vec::new(),
          pipeline: None,
          meta: None,
          resolver_meta: None,
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
      DependencyKind::File => {
        invalidate_on_file_change.push(dep.specifier.to_string());
      }
      _ => {
        let mut flags = dep_flags;
        flags.set(DependencyFlags::OPTIONAL, dep.is_optional);
        flags.set(
          DependencyFlags::IS_ESM,
          matches!(dep.kind, DependencyKind::Import | DependencyKind::Export),
        );

        let mut env = env.clone();
        if dep.kind == DependencyKind::DynamicImport {
          // https://html.spec.whatwg.org/multipage/webappapis.html#hostimportmoduledynamically(referencingscriptormodule,-modulerequest,-promisecapability)
          if matches!(
            env.context,
            EnvironmentContext::Worklet | EnvironmentContext::ServiceWorker
          ) {
            let diagnostic = Diagnostic {
              message: format!(
                "import() is not allowed in {}.",
                match env.context {
                  EnvironmentContext::Worklet => "worklets",
                  EnvironmentContext::ServiceWorker => "service workers",
                  _ => unreachable!(),
                }
              ),
              code_highlights: Some(vec![CodeHighlight {
                loc: dep.loc.clone(),
                message: None,
              }]),
              hints: Some(vec!["Try using a static `import`.".into()]),
              show_environment: true,
              severity: parcel_js_swc_core::DiagnosticSeverity::Error,
              documentation_url: None,
            };
            result.diagnostics.get_or_insert(vec![]).push(diagnostic);
          }

          // If all of the target engines support dynamic import natively,
          // we can output native ESM if scope hoisting is enabled.
          // Only do this for scripts, rather than modules in the global
          // output format so that assets can be shared between the bundles.
          let mut output_format = env.output_format;
          if env.source_type == SourceType::Script
            && env.flags.contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
          // && config.supports_dynamic_import TODO
          {
            output_format = OutputFormat::Esmodule;
          }

          if env.source_type != SourceType::Module || env.output_format != output_format {
            env = Environment {
              source_type: SourceType::Module,
              output_format,
              loc: Some(loc.clone()),
              ..env.clone()
            };
          }
        }

        // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
        let is_helper = dep.is_helper
          && !(dep.specifier.ends_with("/jsx-runtime")
            || dep.specifier.ends_with("/jsx-dev-runtime"));
        if is_helper && !env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          env = Environment {
            include_node_modules: IncludeNodeModules::Bool(true),
            ..env.clone()
          };
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

          // resolve_from = Some(to_project_path(
          //   &config.resolve_helpers_from,
          //   &db.options.project_root,
          // ));
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
          specifier: dep.specifier.as_ref().into(),
          specifier_type: match dep.kind {
            DependencyKind::Require => SpecifierType::Commonjs,
            _ => SpecifierType::Esm,
          },
          source_path: Some(file_path.clone()),
          env,
          resolve_from,
          range,
          priority: match dep.kind {
            DependencyKind::DynamicImport => Priority::Lazy,
            _ => Priority::Sync,
          },
          bundle_behavior: BundleBehavior::None,
          flags,
          loc: Some(loc.clone()),
          placeholder: dep.placeholder.map(|s| s.into()),
          target: None,
          symbols: Vec::new(),
          promise_symbol: None,
          import_attributes,
          pipeline: None,
          meta: None,
          resolver_meta: None,
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
    }
  }

  if result.needs_esm_helpers {
    let d = Dependency {
      specifier: "@parcel/transformer-js/src/esmodule-helpers.js".into(),
      specifier_type: SpecifierType::Esm,
      source_path: Some(file_path.clone()),
      env: Environment {
        include_node_modules: IncludeNodeModules::Map(indexmap! {
          "@parcel/transformer-js".into() => true
        }),
        ..env.clone()
      },
      // resolve_from: Some(to_project_path(
      //   &config.resolve_helpers_from,
      //   &db.options.project_root,
      // )),
      resolve_from: None,
      range: None,
      priority: Priority::Sync,
      bundle_behavior: BundleBehavior::None,
      flags: dep_flags,
      loc: None,
      placeholder: None,
      target: None,
      promise_symbol: None,
      symbols: Vec::new(),
      import_attributes: Vec::new(),
      pipeline: None,
      meta: None,
      resolver_meta: None,
      package_conditions: ExportsCondition::empty(),
      custom_package_conditions: Vec::new(),
    };

    // dep_map.insert(d.specifier.as_str().into(), d);
  }

  let mut has_cjs_exports = false;
  let mut static_cjs_exports = false;
  let mut should_wrap = false;

  let symbols = &mut asset.symbols;
  if let Some(hoist_result) = result.hoist_result {
    asset.flags |= AssetFlags::HAS_SYMBOLS;
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
          let re_export_name = dep
            .symbols
            .as_slice()
            .iter()
            .find(|sym| sym.exported == &*s.imported)
            .map(|sym| sym.local.clone())
            .unwrap_or_else(|| format!("${}$re_export${}", asset.id, s.local).into());
          dep.symbols.push(Symbol {
            exported: s.imported.as_ref().into(),
            local: re_export_name.clone(),
            loc: Some(convert_loc(file_path.clone(), &s.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
          symbols.push(Symbol {
            exported: s.local.as_ref().into(),
            local: re_export_name,
            loc: Some(convert_loc(file_path.clone(), &s.loc)),
            flags: SymbolFlags::empty(),
          });
        }
      }
    }

    for specifier in hoist_result.wrapped_requires {
      if let Some(dep) = dep_map.get_mut(&specifier) {
        dep.flags |= DependencyFlags::SHOULD_WRAP;
      }
    }

    for (name, specifier) in hoist_result.dynamic_imports {
      if let Some(dep) = dep_map.get_mut(&specifier) {
        dep.promise_symbol = Some((&*name).into());
      }
    }

    if !hoist_result.self_references.is_empty() {
      let mut dep_symbols = Vec::new();
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

        let local = symbols
          .iter()
          .find(|s| s.exported.as_str() == name.as_str())
          .unwrap()
          .local
          .clone();
        dep_symbols.push(Symbol {
          exported: name.as_str().into(),
          local,
          flags: SymbolFlags::empty(),
          loc: None,
        });
      }

      // Create a dependency on the asset itself by using the unique key as a specifier.
      // Using the unique key ensures that the dependency always resolves to the correct asset,
      // even if it came from a transformer that produced multiple assets (e.g. css modules).
      // Also avoids needing a resolution request.
      // let mut d = Dependency::new(asset.id, asset_id);
      // d.flags = dep_flags;
      // d.symbols = dep_symbols;
      // dep_map.insert(d.specifier, d);
      // TODO
    }

    // Add * symbol if there are CJS exports, no imports/exports at all
    // (and the asset has side effects), or the asset is wrapped.
    // This allows accessing symbols that don't exist without errors in symbol propagation.
    if (hoist_result.has_cjs_exports
      || (!hoist_result.is_esm
        && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
        && dep_map.is_empty()
        && hoist_result.exported_symbols.is_empty())
      || hoist_result.should_wrap)
      && !symbols.as_slice().iter().any(|s| s.exported == "*")
    {
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${}$exports", asset.id).into(),
        loc: None,
        flags: SymbolFlags::empty(),
      });
    }

    has_cjs_exports = hoist_result.has_cjs_exports;
    static_cjs_exports = hoist_result.static_cjs_exports;
    should_wrap = hoist_result.should_wrap;
  } else {
    if let Some(symbol_result) = result.symbol_result {
      asset.flags |= AssetFlags::HAS_SYMBOLS;
      symbols.reserve(symbol_result.exports.len() + 1);
      for sym in &symbol_result.exports {
        let local = if let Some(dep) = sym
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
          local
        } else {
          format!("${}", sym.local).into()
        };

        symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: Some(convert_loc(file_path.clone(), &sym.loc)),
          flags: SymbolFlags::empty(),
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
          && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
          && dep_map.is_empty()
          && symbol_result.exports.is_empty())
        || (symbol_result.should_wrap && !symbols.as_slice().iter().any(|s| s.exported == "*"))
      {
        symbols.push(Symbol {
          exported: "*".into(),
          local: format!("${}$exports", asset.id).into(),
          loc: None,
          flags: SymbolFlags::empty(),
        });
      }
    } else {
      // If the asset is wrapped, add * as a fallback
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${}$exports", asset.id).into(),
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
          local: format!("${}$", dep.placeholder.as_ref().unwrap_or(&dep.specifier)).clone(),
          flags: SymbolFlags::empty(),
          loc: None,
        });
      }
    }
  }

  asset.flags.set(
    AssetFlags::HAS_NODE_REPLACEMENTS,
    result.has_node_replacements,
  );
  asset
    .flags
    .set(AssetFlags::IS_CONSTANT_MODULE, result.is_constant_module);
  asset
    .flags
    .set(AssetFlags::HAS_CJS_EXPORTS, has_cjs_exports);
  asset
    .flags
    .set(AssetFlags::STATIC_EXPORTS, static_cjs_exports);
  asset.flags.set(AssetFlags::SHOULD_WRAP, should_wrap);

  if asset.unique_key.is_none() {
    asset.unique_key = Some(asset.id.clone());
  }

  AssetRequestResult {
    asset,
    code: result.code,
    dependencies: dep_map.into_values().collect(),
    // code: result.code,
    // map: result.map,
    // shebang: result.shebang,
    // dependencies: deps,
    // diagnostics: result.diagnostics,
    // used_env: result.used_env.into_iter().map(|v| v.to_string()).collect(),
    // invalidate_on_file_change,
  }
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

// fn remap_source_location(loc: &mut SourceLocation, map: &mut SourceMap) {
//   let line_diff = loc.end.line - loc.start.line;
//   let col_diff = loc.end.column - loc.start.column;

//   let start = map.find_closest_mapping(loc.start.line - 1, loc.start.column - 1);
//   let end = map.find_closest_mapping(loc.end.line - 1, loc.end.column - 1);

//   if let Some(start) = start {
//     if let Some(original) = start.original {
//       if let Ok(source) = map.get_source(original.source) {
//         loc.file_path = source.into();
//       }

//       loc.start.line = original.original_line + 1;
//       loc.start.column = original.original_column + 1; // source map columns are 0-based
//     }
//   }

//   if let Some(end) = end {
//     if let Some(original) = end.original {
//       loc.end.line = original.original_line + 1;
//       loc.end.column = original.original_column + 1; // source map columns are 0-based

//       if loc.end.line < loc.start.line {
//         loc.end.line = loc.start.line;
//         loc.end.column = loc.start.column;
//       } else if loc.end.line == loc.start.line
//         && loc.end.column < loc.start.column
//         && line_diff == 0
//       {
//         loc.end.column = loc.start.column + col_diff;
//       } else if loc.end.line == loc.start.line
//         && loc.start.column == loc.end.column
//         && line_diff == 0
//       {
//         // Prevent 0-length ranges
//         loc.end.column = loc.start.column + 1;
//       }

//       return;
//     }
//   }

//   loc.end.line = loc.start.line;
//   loc.end.column = loc.start.column;
// }

// fn to_project_path(path: &str, project_root: &str) -> InternedString {
//   let res = pathdiff::diff_paths(path, project_root)
//     .map(|p| p.to_slash_lossy())
//     .unwrap_or_else(|| path.to_string());

//   // If the file is outside the project root, store an absolute path rather
//   // than a relative one. This way if the project root is moved, the file
//   // references still work. Accessing files outside the project root is not
//   // portable anyway.
//   if res.starts_with("..") {
//     return std::path::Path::new(path).to_slash_lossy().into();
//   }

//   res.into()
// }
