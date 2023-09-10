use std::collections::{HashMap, HashSet};

use crate::db::JsParcelDb;
use napi::{Env, JsObject, JsUnknown, Result};
use napi_derive::napi;
use parcel_db::{
  ArenaVec, BundleBehavior, Dependency, DependencyFlags, Environment, EnvironmentContext,
  EnvironmentFlags, EnvironmentId, ImportAttribute, InternedString, Location, OutputFormat,
  ParcelDb, Priority, SourceLocation, SourceType, SpecifierType, Symbol, SymbolFlags, TargetId,
  Vec,
};
use parcel_js_swc_core::{CodeHighlight, DependencyKind, Diagnostic, TransformResult};
use path_slash::{PathBufExt, PathExt};
use serde::{Deserialize, Serialize};

#[napi]
pub fn transform(db: &JsParcelDb, opts: JsObject, env: Env) -> Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

  db.with(|db| {
    let result = convert_result(db, &config, parcel_js_swc_core::transform(&config)?);
    env.to_js_value(&result)
  })
}

#[cfg(not(target_arch = "wasm32"))]
#[napi]
pub fn transform_async(db: &JsParcelDb, opts: JsObject, env: Env) -> Result<JsObject> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;
  let (deferred, promise) = env.create_deferred()?;
  let db = db.db();

  rayon::spawn(move || {
    let res = parcel_js_swc_core::transform(&config);
    match res {
      Ok(result) => deferred
        .resolve(move |env| db.with(|db| env.to_js_value(&convert_result(db, &config, result)))),
      Err(err) => deferred.reject(err.into()),
    }
  });

  Ok(promise)
}

#[derive(Serialize, Debug, Default)]
pub struct TransformResult2 {
  #[serde(with = "serde_bytes")]
  pub code: std::vec::Vec<u8>,
  pub map: Option<String>,
  pub shebang: Option<String>,
  pub dependencies: std::vec::Vec<u32>,
  pub symbols: u32,
  // pub hoist_result: Option<HoistResult>,
  // pub symbol_result: Option<CollectResult>,
  pub diagnostics: Option<std::vec::Vec<Diagnostic>>,
  pub used_env: HashSet<String>,
  pub has_node_replacements: bool,
  pub has_cjs_exports: bool,
  pub static_cjs_exports: bool,
  pub should_wrap: bool,
}

fn convert_result(
  db: &ParcelDb,
  config: &parcel_js_swc_core::Config,
  mut result: TransformResult,
) -> TransformResult2 {
  let file_path = to_project_path(&config.filename, &config.project_root);

  let mut deps = std::vec::Vec::new();
  let mut dep_map = HashMap::new();
  for dep in result.dependencies {
    match dep.kind {
      DependencyKind::WebWorker => {
        let env = db.get_environment(config.env_id);
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
          priority: Priority::Lazy,
          flags: DependencyFlags::IS_WEBWORKER,
          bundle_behavior: BundleBehavior::None,
          resolve_from: Some(file_path),
          range: None,
          source_asset_id: None,
          placeholder: dep.placeholder.map(|s| s.into()),
          promise_symbol: None,
          symbols: ArenaVec::new(),
          loc: Some(convert_loc(file_path, &dep.loc)),
          target: TargetId(0),
          env: db.environment_id(&Environment {
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
            loc: Some(convert_loc(file_path, &dep.loc)),
            ..env.clone()
          }),
          import_attributes: ArenaVec::new(),
        };
        let placeholder = d.placeholder.as_ref().unwrap_or(&d.specifier).clone();
        let id = db.create_dependency(d);
        deps.push(id);
        dep_map.insert(placeholder, id);
      }
      DependencyKind::ServiceWorker => {
        let d = Dependency {
          specifier: dep.specifier.as_ref().into(),
          specifier_type: SpecifierType::Url,
          priority: Priority::Lazy,
          flags: DependencyFlags::NEEDS_STABLE_NAME,
          bundle_behavior: BundleBehavior::None,
          resolve_from: Some(file_path),
          range: None,
          source_asset_id: None,
          placeholder: dep.placeholder.map(|s| s.into()),
          promise_symbol: None,
          symbols: ArenaVec::new(),
          loc: Some(convert_loc(file_path, &dep.loc)),
          target: TargetId(0),
          env: db.environment_id(&Environment {
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
            loc: Some(convert_loc(file_path, &dep.loc)),
            ..db.get_environment(config.env_id).clone()
          }),
          import_attributes: ArenaVec::new(),
        };
        let placeholder = d.placeholder.as_ref().unwrap_or(&d.specifier).clone();
        let id = db.create_dependency(d);
        deps.push(id);
        dep_map.insert(placeholder, id);
      }
      DependencyKind::Worklet => {
        let d = Dependency {
          specifier: dep.specifier.as_ref().into(),
          specifier_type: SpecifierType::Url,
          priority: Priority::Lazy,
          flags: DependencyFlags::empty(),
          bundle_behavior: BundleBehavior::None,
          resolve_from: Some(file_path),
          range: None,
          source_asset_id: None,
          placeholder: dep.placeholder.map(|s| s.into()),
          promise_symbol: None,
          symbols: ArenaVec::new(),
          loc: Some(convert_loc(file_path, &dep.loc)),
          target: TargetId(0),
          env: db.environment_id(&Environment {
            context: EnvironmentContext::Worklet,
            source_type: SourceType::Module,
            output_format: OutputFormat::Esmodule,
            loc: Some(convert_loc(file_path, &dep.loc)),
            ..db.get_environment(config.env_id).clone()
          }),
          import_attributes: ArenaVec::new(),
        };
        let placeholder = d.placeholder.as_ref().unwrap_or(&d.specifier).clone();
        let id = db.create_dependency(d);
        deps.push(id);
        dep_map.insert(placeholder, id);
      }
      DependencyKind::Url => {
        let d = Dependency {
          specifier: dep.specifier.as_ref().into(),
          specifier_type: SpecifierType::Url,
          priority: Priority::Lazy,
          flags: DependencyFlags::empty(),
          bundle_behavior: BundleBehavior::Isolated,
          resolve_from: Some(file_path),
          range: None,
          source_asset_id: None,
          placeholder: dep.placeholder.map(|s| s.into()),
          promise_symbol: None,
          symbols: ArenaVec::new(),
          loc: Some(convert_loc(file_path, &dep.loc)),
          target: TargetId(0),
          env: EnvironmentId(config.env_id),
          import_attributes: ArenaVec::new(),
        };
        let placeholder = d.placeholder.as_ref().unwrap_or(&d.specifier).clone();
        let id = db.create_dependency(d);
        deps.push(id);
        dep_map.insert(placeholder, id);
      }
      DependencyKind::File => {}
      _ => {
        let mut flags = DependencyFlags::empty();
        flags.set(DependencyFlags::OPTIONAL, dep.is_optional);
        flags.set(
          DependencyFlags::IS_ESM,
          matches!(dep.kind, DependencyKind::Import | DependencyKind::Export),
        );

        let mut env_id = EnvironmentId(config.env_id);
        let mut env = db.get_environment(config.env_id);
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
          if config.source_type == parcel_js_swc_core::SourceType::Script
            && config.scope_hoist
            && config.supports_dynamic_import
          {
            output_format = OutputFormat::Esmodule;
          }

          if env.source_type != SourceType::Module || env.output_format != output_format {
            env_id = db.environment_id(&Environment {
              source_type: SourceType::Module,
              output_format,
              loc: Some(convert_loc(file_path, &dep.loc)),
              ..env.clone()
            });
            env = db.get_environment(env_id.0);
          }
        }

        // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
        let is_helper = dep.is_helper
          && !(dep.specifier.ends_with("/jsx-runtime")
            || dep.specifier.ends_with("/jsx-dev-runtime"));
        if is_helper && !env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          env_id = db.environment_id(&Environment {
            include_node_modules: InternedString::from("true"),
            ..env.clone()
          });
        }

        // Add required version range for helpers.
        let mut range = None;
        let mut resolve_from = Some(file_path);
        if is_helper {
          // TODO: get versions from package.json? Can we do it at compile time?
          if dep.specifier.starts_with("@swc/helpers") {
            range = Some("^0.5.0".into());
          } else if dep.specifier.starts_with("regenerator-runtime") {
            range = Some("^0.13.7".into());
          }

          resolve_from = Some(to_project_path(
            &config.resolve_helpers_from,
            &config.project_root,
          ));
        }

        let mut import_attributes = ArenaVec::new();
        if let Some(attrs) = dep.attributes {
          for (key, value) in attrs {
            import_attributes.push(ImportAttribute {
              key: InternedString::from(&*key),
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
          priority: match dep.kind {
            DependencyKind::DynamicImport => Priority::Lazy,
            _ => Priority::Sync,
          },
          flags,
          bundle_behavior: BundleBehavior::None,
          resolve_from,
          range,
          source_asset_id: None,
          placeholder: dep.placeholder.map(|s| s.into()),
          promise_symbol: None,
          symbols: ArenaVec::new(),
          loc: Some(convert_loc(file_path, &dep.loc)),
          target: TargetId(0),
          env: env_id,
          import_attributes,
        };

        let placeholder = d.placeholder.as_ref().unwrap_or(&d.specifier).clone();
        let id = db.create_dependency(d);
        deps.push(id);
        dep_map.insert(placeholder, id);
      }
    }
  }

  if result.needs_esm_helpers {
    let d = Dependency {
      specifier: "@parcel/transformer-js/src/esmodule-helpers.js".into(),
      specifier_type: SpecifierType::Esm,
      priority: Priority::Sync,
      flags: DependencyFlags::empty(),
      bundle_behavior: BundleBehavior::None,
      resolve_from: Some(to_project_path(
        &config.resolve_helpers_from,
        &config.project_root,
      )),
      range: None,
      source_asset_id: None,
      placeholder: None,
      promise_symbol: None,
      symbols: ArenaVec::new(),
      loc: None,
      target: TargetId(0),
      env: db.environment_id(&Environment {
        include_node_modules: InternedString::from("{\"@parcel/transformer-js\":true}"),
        ..db.get_environment(config.env_id).clone()
      }),
      import_attributes: ArenaVec::new(),
    };
    deps.push(db.create_dependency(d));
  }

  let mut has_cjs_exports = false;
  let mut static_cjs_exports = false;
  let mut should_wrap = false;

  let (symbols_addr, symbols) = db.alloc_struct::<ArenaVec<Symbol>>();
  unsafe { std::ptr::write(symbols, ArenaVec::new()) };
  if let Some(hoist_result) = result.hoist_result {
    symbols.reserve(hoist_result.exported_symbols.len() + hoist_result.re_exports.len() + 1);
    // println!("{:?}", hoist_result);
    for s in &hoist_result.exported_symbols {
      let mut flags = SymbolFlags::empty();
      flags.set(SymbolFlags::IS_ESM, s.is_esm);
      let sym = Symbol {
        exported: s.exported.as_ref().into(),
        local: s.local.as_ref().into(),
        loc: Some(convert_loc(file_path, &s.loc)),
        flags,
      };
      symbols.push(sym);
    }

    for s in hoist_result.imported_symbols {
      if let Some(dep_id) = InternedString::get(&*s.source).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = db.read_heap(*dep_id);
        dep.symbols.push(Symbol {
          exported: s.imported.as_ref().into(),
          local: s.local.as_ref().into(),
          loc: Some(convert_loc(file_path, &s.loc)),
          flags: SymbolFlags::empty(),
        });
      }
    }

    for s in hoist_result.re_exports {
      if let Some(dep_id) = InternedString::get(&*s.source).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = db.read_heap(*dep_id);
        if &*s.local == "*" && &*s.imported == "*" {
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: Some(convert_loc(file_path, &s.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
        } else {
          let re_export_name = dep
            .symbols
            .as_slice()
            .iter()
            .find(|sym| sym.exported == &*s.imported)
            .map(|sym| sym.local.clone())
            .unwrap_or_else(|| format!("${}$re_export${}", config.module_id, s.local).into());
          dep.symbols.push(Symbol {
            exported: s.imported.as_ref().into(),
            local: re_export_name.clone(),
            loc: Some(convert_loc(file_path, &s.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
          symbols.push(Symbol {
            exported: s.local.as_ref().into(),
            local: re_export_name,
            loc: Some(convert_loc(file_path, &s.loc)),
            flags: SymbolFlags::empty(),
          });
        }
      }
    }

    for specifier in hoist_result.wrapped_requires {
      if let Some(dep_id) = InternedString::get(&specifier).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = db.read_heap(*dep_id);
        dep.flags |= DependencyFlags::SHOULD_WRAP;
      }
    }

    for (name, specifier) in hoist_result.dynamic_imports {
      if let Some(dep_id) = InternedString::get(&*specifier).and_then(|s| dep_map.get(&s)) {
        let dep: &mut Dependency = db.read_heap(*dep_id);
        dep.promise_symbol = Some((&*name).into());
      }
    }

    if !hoist_result.self_references.is_empty() {
      let mut dep_symbols = ArenaVec::new();
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

        let exported = InternedString::from(&*name);
        let local = symbols
          .as_slice()
          .iter()
          .find(|s| s.exported == exported)
          .unwrap()
          .local;
        dep_symbols.push(Symbol {
          exported,
          local,
          flags: SymbolFlags::empty(),
          loc: None,
        });
      }

      // Create a dependency on the asset itself by using the unique key as a specifier.
      // Using the unique key ensures that the dependency always resolves to the correct asset,
      // even if it came from a transformer that produced multiple assets (e.g. css modules).
      // Also avoids needing a resolution request.
      let d = Dependency {
        specifier: config.module_id.as_str().into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        flags: DependencyFlags::empty(),
        bundle_behavior: BundleBehavior::None,
        resolve_from: None,
        range: None,
        source_asset_id: None,
        placeholder: None,
        promise_symbol: None,
        symbols: dep_symbols,
        loc: None,
        target: TargetId(0),
        env: EnvironmentId(config.env_id),
        import_attributes: ArenaVec::new(),
      };
      deps.push(db.create_dependency(d));
    }

    // Add * symbol if there are CJS exports, no imports/exports at all
    // (and the asset has side effects), or the asset is wrapped.
    // This allows accessing symbols that don't exist without errors in symbol propagation.
    if (hoist_result.has_cjs_exports
      || (!hoist_result.is_esm
        && config.side_effects
        && deps.is_empty()
        && hoist_result.exported_symbols.is_empty())
      || hoist_result.should_wrap)
      && !symbols.as_slice().iter().any(|s| s.exported == "*")
    {
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${}$exports", &config.module_id).into(),
        loc: None,
        flags: SymbolFlags::empty(),
      });
    }

    has_cjs_exports = hoist_result.has_cjs_exports;
    static_cjs_exports = hoist_result.static_cjs_exports;
    should_wrap = hoist_result.should_wrap;
  } else {
    if let Some(symbol_result) = result.symbol_result {
      symbols.reserve(symbol_result.exports.len() + 1);
      for sym in &symbol_result.exports {
        let local = if let Some(dep_id) = sym
          .source
          .as_ref()
          .and_then(|s| InternedString::get(&*s))
          .and_then(|s| dep_map.get(&s))
        {
          let dep: &mut Dependency = db.read_heap(*dep_id);
          let local = format!("${}${}", *dep_id, sym.local).into();
          dep.symbols.push(Symbol {
            exported: sym.local.as_ref().into(),
            local,
            loc: Some(convert_loc(file_path, &sym.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
          local
        } else {
          format!("${}", sym.local).into()
        };

        symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: Some(convert_loc(file_path, &sym.loc)),
          flags: SymbolFlags::empty(),
        });
      }

      for sym in symbol_result.imports {
        if let Some(dep_id) = InternedString::get(&*sym.source).and_then(|s| dep_map.get(&s)) {
          let dep: &mut Dependency = db.read_heap(*dep_id);
          dep.symbols.push(Symbol {
            exported: sym.imported.as_ref().into(),
            local: sym.local.as_ref().into(),
            loc: Some(convert_loc(file_path, &sym.loc)),
            flags: SymbolFlags::empty(),
          });
        }
      }

      for sym in symbol_result.exports_all {
        if let Some(dep_id) = InternedString::get(&*sym.source).and_then(|s| dep_map.get(&s)) {
          let dep: &mut Dependency = db.read_heap(*dep_id);
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: Some(convert_loc(file_path, &sym.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
        }
      }

      // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if symbol_result.has_cjs_exports
        || (!symbol_result.is_esm
          && config.side_effects
          && deps.is_empty()
          && symbol_result.exports.is_empty())
        || (symbol_result.should_wrap && !symbols.as_slice().iter().any(|s| s.exported == "*"))
      {
        symbols.push(Symbol {
          exported: "*".into(),
          local: format!("${}$exports", &config.module_id).into(),
          loc: None,
          flags: SymbolFlags::empty(),
        });
      }
    } else {
      // If the asset is wrapped, add * as a fallback
      symbols.push(Symbol {
        exported: "*".into(),
        local: format!("${}$exports", &config.module_id).into(),
        loc: None,
        flags: SymbolFlags::empty(),
      });
    }

    // For all other imports and requires, mark everything as imported (this covers both dynamic
    // imports and non-top-level requires.)
    for dep_id in &deps {
      let dep: &mut Dependency = db.read_heap(*dep_id);
      if dep.symbols.is_empty() {
        dep.symbols.push(Symbol {
          exported: "*".into(),
          local: format!("${}$", dep_id).into(),
          flags: SymbolFlags::empty(),
          loc: None,
        });
      }
    }
  }

  // println!("SYMBOLS {:?} {:?}", config.filename, symbols);
  // for id in &deps {
  //   let dep: &mut Dependency = db.read_heap(*id);
  //   println!("{:?}", dep);
  // }
  //
  // println!(
  //   "{:?}",
  //   deps
  //     .iter()
  //     .map(|d| db.read_heap::<Dependency>(*d))
  //     .collect::<std::vec::Vec<_>>()
  // );

  TransformResult2 {
    code: result.code,
    map: result.map,
    shebang: result.shebang,
    dependencies: deps,
    symbols: symbols_addr,
    diagnostics: result.diagnostics,
    used_env: result.used_env.into_iter().map(|v| v.to_string()).collect(),
    has_node_replacements: result.has_node_replacements,
    has_cjs_exports,
    static_cjs_exports,
    should_wrap,
  }
}

fn convert_loc(
  file_path: InternedString,
  loc: &parcel_js_swc_core::SourceLocation,
) -> SourceLocation {
  // TODO: remap original source map
  SourceLocation {
    file_path,
    start: Location {
      line: loc.start_line as u32, // + (asset.meta.startLine ?? 1) - 1
      column: loc.start_col as u32,
    },
    end: Location {
      line: loc.end_line as u32,
      column: loc.end_col as u32,
    },
  }
}

fn to_project_path(path: &str, project_root: &str) -> InternedString {
  let res = pathdiff::diff_paths(path, project_root)
    .map(|p| p.to_slash_lossy())
    .unwrap_or_else(|| path.to_string());

  // If the file is outside the project root, store an absolute path rather
  // than a relative one. This way if the project root is moved, the file
  // references still work. Accessing files outside the project root is not
  // portable anyway.
  if res.starts_with("..") {
    return std::path::Path::new(path).to_slash_lossy().into();
  }

  res.into()
}
