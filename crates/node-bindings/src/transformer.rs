use std::{collections::HashSet, num::NonZeroU32, path::Path};

use crate::db::JsParcelDb;
use indexmap::IndexMap;
use napi::{Env, JsBuffer, JsObject, JsUnknown, Result};
use napi_derive::napi;
use parcel_db::{
  ArenaVec, AssetFlags, AssetId, AssetType, BuildMode, BundleBehavior, Dependency, DependencyFlags,
  Environment, EnvironmentContext, EnvironmentFlags, ImportAttribute, InternedString, Location,
  LogLevel, OutputFormat, ParcelDb, Priority, SourceLocation, SourceType, SpecifierType, Symbol,
  SymbolFlags,
};
use parcel_js_swc_core::{
  CodeHighlight, Config, DependencyKind, Diagnostic, InlineEnvironment, TransformResult, Version,
  Versions,
};
use parcel_sourcemap::SourceMap;
use path_slash::{PathBufExt, PathExt};
use serde::{Deserialize, Serialize};

#[napi]
pub fn transform(db: &JsParcelDb, opts: JsObject, env: Env) -> Result<JsUnknown> {
  let mut code = opts.get_named_property::<JsBuffer>("code")?.into_ref()?;
  let map: Result<JsBuffer> = opts.get_named_property::<JsUnknown>("map")?.try_into();
  let mut map = if let Ok(buf) = map {
    Some(buf.into_ref()?)
  } else {
    None
  };

  let config: Config2 = env.from_js_value(opts)?;

  db.with(|db| {
    let asset_id = AssetId(config.asset_id);
    let transformer_config = convert_config(db, &config);
    let result = convert_result(
      db,
      asset_id,
      &config,
      map.as_ref().map(|m| m.as_ref()),
      parcel_js_swc_core::transform(&code, &transformer_config, None),
    );
    code.unref(env)?;
    if let Some(map) = &mut map {
      map.unref(env)?;
    }
    env.to_js_value(&result)
  })
}

#[cfg(not(target_arch = "wasm32"))]
mod native_only {
  use super::*;
  use parcel_macros::napi::create_macro_callback;

  #[napi]
  pub fn transform_async(db: &JsParcelDb, opts: JsObject, env: Env) -> Result<JsObject> {
    let call_macro = if opts.has_named_property("callMacro")? {
      let func = opts.get_named_property::<JsUnknown>("callMacro")?;
      if let Ok(func) = func.try_into() {
        Some(create_macro_callback(func, env)?)
      } else {
        None
      }
    } else {
      None
    };

    let mut code = opts.get_named_property::<JsBuffer>("code")?.into_ref()?;
    let map: Result<JsBuffer> = opts.get_named_property::<JsUnknown>("map")?.try_into();
    let mut map = if let Ok(buf) = map {
      Some(buf.into_ref()?)
    } else {
      None
    };

    let config: Config2 = env.from_js_value(opts)?;
    let asset_id = AssetId(config.asset_id);

    let (deferred, promise) = env.create_deferred()?;
    let db = db.db();

    rayon::spawn(move || {
      let transformer_config = db.with(|db| convert_config(db, &config));
      let result = parcel_js_swc_core::transform(&code, &transformer_config, call_macro);
      deferred.resolve(move |env| {
        let res = db.with(|db| {
          convert_result(
            db,
            asset_id,
            &config,
            map.as_ref().map(|m| m.as_ref()),
            result,
          )
        });
        code.unref(env)?;
        if let Some(map) = &mut map {
          map.unref(env)?;
        }
        env.to_js_value(&res)
      })
    });

    Ok(promise)
  }
}

#[derive(Serialize, Debug, Deserialize)]
pub struct Config2 {
  pub asset_id: NonZeroU32,
  pub inline_environment: InlineEnvironment,
  pub inline_fs: bool,
  pub is_jsx: bool,
  pub jsx_pragma: Option<String>,
  pub jsx_pragma_frag: Option<String>,
  pub automatic_jsx_runtime: bool,
  pub jsx_import_source: Option<String>,
  pub decorators: bool,
  pub use_define_for_class_fields: bool,
  pub react_refresh: bool,
  pub supports_module_workers: bool,
  pub inline_constants: bool,
  pub resolve_helpers_from: String,
  pub supports_dynamic_import: bool,
}

// List of browsers to exclude when the esmodule target is specified.
// Based on https://caniuse.com/#feat=es6-module
const ESMODULE_BROWSERS: &'static [&'static str] = &[
  "not ie <= 11",
  "not edge < 16",
  "not firefox < 60",
  "not chrome < 61",
  "not safari < 11",
  "not opera < 48",
  "not ios_saf < 11",
  "not op_mini all",
  "not android < 76",
  "not blackberry > 0",
  "not op_mob > 0",
  "not and_chr < 76",
  "not and_ff < 68",
  "not ie_mob > 0",
  "not and_uc > 0",
  "not samsung < 8.2",
  "not and_qq > 0",
  "not baidu > 0",
  "not kaios > 0",
];

fn convert_config<'a>(db: &'a ParcelDb, config: &'a Config2) -> Config<'a> {
  let asset = db.get_asset(AssetId(config.asset_id));
  let env = db.get_environment(asset.env);
  let mut targets = None;
  if env.context.is_electron() {
    if let Some(electron) = env
      .engines
      .electron
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
  } else if env.context.is_browser() && !env.engines.browsers.is_empty() {
    let env_browsers = env.engines.browsers.as_slice();
    let browsers = if env.output_format == OutputFormat::Esmodule {
      // If the output format is esmodule, exclude browsers
      // that support them natively so that we transpile less.
      browserslist::resolve(
        env_browsers
          .iter()
          .map(|s| s.as_str())
          .chain(ESMODULE_BROWSERS.iter().map(|s| *s)),
        &Default::default(),
      )
    } else {
      browserslist::resolve(env_browsers, &Default::default())
    };

    if let Some(browsers) = browsers.ok().and_then(|v| Versions::parse_versions(v).ok()) {
      targets = Some(browsers);
    }
  } else if env.context.is_node() {
    if let Some(node) = env
      .engines
      .node
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
    filename: Path::new(&db.options.project_root).join(asset.file_path.as_str()),
    module_id: asset.id.as_str(),
    project_root: &db.options.project_root,
    replace_env: !env.context.is_node(),
    env: &db.options.env,
    inline_environment: &config.inline_environment,
    inline_fs: config.inline_fs,
    insert_node_globals: !env.context.is_node() && env.source_type != SourceType::Script,
    node_replacer: env.context.is_node(),
    is_browser: env.context.is_browser(),
    is_worker: env.context.is_worker(),
    is_type_script: matches!(asset.asset_type, AssetType::Ts | AssetType::Tsx),
    is_jsx: config.is_jsx,
    jsx_pragma: &config.jsx_pragma,
    jsx_pragma_frag: &config.jsx_pragma_frag,
    automatic_jsx_runtime: config.automatic_jsx_runtime,
    jsx_import_source: &config.jsx_import_source,
    decorators: config.decorators,
    use_define_for_class_fields: config.use_define_for_class_fields,
    is_development: db.options.mode == BuildMode::Development,
    react_refresh: config.react_refresh,
    targets,
    source_maps: env.source_map.is_some(),
    scope_hoist: env.flags.contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
      && env.source_type != SourceType::Script,
    source_type: match env.source_type {
      SourceType::Script => parcel_js_swc_core::SourceType::Script,
      _ => parcel_js_swc_core::SourceType::Module,
    },
    supports_module_workers: config.supports_module_workers,
    is_library: env.flags.contains(EnvironmentFlags::IS_LIBRARY),
    is_esm_output: env.output_format == OutputFormat::Esmodule,
    trace_bailouts: db.options.log_level == LogLevel::Verbose,
    is_swc_helpers: asset.file_path.contains("@swc/helpers"),
    standalone: asset.query.map_or(false, |q| q.contains("standalone=true")), // TODO: use a real parser
    inline_constants: config.inline_constants,
  }
}

#[derive(Serialize, Debug, Default)]
pub struct TransformResult2 {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub map: Option<String>,
  pub shebang: Option<String>,
  pub dependencies: Vec<u32>,
  pub diagnostics: Option<Vec<Diagnostic>>,
  pub used_env: HashSet<String>,
  pub invalidate_on_file_change: Vec<String>,
}

fn convert_result(
  db: &ParcelDb,
  asset_id: AssetId,
  config: &Config2,
  map_buf: Option<&[u8]>,
  mut result: TransformResult,
) -> TransformResult2 {
  let asset = db.get_asset_mut(asset_id);
  let env = db.get_environment(asset.env);
  let file_path = asset.file_path;

  let mut map = if let Some(buf) = map_buf {
    SourceMap::from_buffer(&db.options.project_root, buf).ok()
  } else {
    None
  };

  let mut dep_map = IndexMap::new();
  let mut dep_flags = DependencyFlags::empty();
  dep_flags.set(
    DependencyFlags::HAS_SYMBOLS,
    result.hoist_result.is_some() || result.symbol_result.is_some(),
  );

  let mut invalidate_on_file_change = Vec::new();

  for dep in result.dependencies {
    let loc = convert_loc(file_path, &dep.loc, &mut map);

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

        let mut d = Dependency::new(dep.specifier.as_ref().into(), asset_id);
        d.specifier_type = SpecifierType::Url;
        d.priority = Priority::Lazy;
        d.flags = dep_flags | DependencyFlags::IS_WEBWORKER;
        d.placeholder = dep.placeholder.map(|s| s.into());
        d.loc = Some(loc.clone());
        d.env = db.environment_id(&Environment {
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
        });
        let placeholder = d.placeholder.unwrap_or(d.specifier);
        dep_map.insert(placeholder, d);
      }
      DependencyKind::ServiceWorker => {
        let mut d = Dependency::new(dep.specifier.as_ref().into(), asset_id);
        d.specifier_type = SpecifierType::Url;
        d.priority = Priority::Lazy;
        d.flags = dep_flags | DependencyFlags::NEEDS_STABLE_NAME;
        d.placeholder = dep.placeholder.map(|s| s.into());
        d.loc = Some(loc.clone());
        d.env = db.environment_id(&Environment {
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
        });
        let placeholder = d.placeholder.unwrap_or(d.specifier);
        dep_map.insert(placeholder, d);
      }
      DependencyKind::Worklet => {
        let mut d = Dependency::new(dep.specifier.as_ref().into(), asset_id);
        d.specifier_type = SpecifierType::Url;
        d.priority = Priority::Lazy;
        d.flags = dep_flags;
        d.placeholder = dep.placeholder.map(|s| s.into());
        d.loc = Some(loc.clone());
        d.env = db.environment_id(&Environment {
          context: EnvironmentContext::Worklet,
          source_type: SourceType::Module,
          output_format: OutputFormat::Esmodule,
          loc: Some(loc.clone()),
          ..env.clone()
        });
        let placeholder = d.placeholder.unwrap_or(d.specifier);
        dep_map.insert(placeholder, d);
      }
      DependencyKind::Url => {
        let mut d = Dependency::new(dep.specifier.as_ref().into(), asset_id);
        d.specifier_type = SpecifierType::Url;
        d.priority = Priority::Lazy;
        d.bundle_behavior = BundleBehavior::Isolated;
        d.flags = dep_flags;
        d.placeholder = dep.placeholder.map(|s| s.into());
        d.loc = Some(loc.clone());
        let placeholder = d.placeholder.unwrap_or(d.specifier);
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

        let mut env_id = asset.env;
        let mut env = env;
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
            && config.supports_dynamic_import
          {
            output_format = OutputFormat::Esmodule;
          }

          if env.source_type != SourceType::Module || env.output_format != output_format {
            env_id = db.environment_id(&Environment {
              source_type: SourceType::Module,
              output_format,
              loc: Some(loc.clone()),
              ..env.clone()
            });
            env = db.get_environment(env_id);
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
        let mut resolve_from = None;
        if is_helper {
          // TODO: get versions from package.json? Can we do it at compile time?
          if dep.specifier.starts_with("@swc/helpers") {
            range = Some("^0.5.0".into());
          } else if dep.specifier.starts_with("regenerator-runtime") {
            range = Some("^0.13.7".into());
          }

          resolve_from = Some(to_project_path(
            &config.resolve_helpers_from,
            &db.options.project_root,
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

        let mut d = Dependency::new(dep.specifier.as_ref().into(), asset_id);
        d.specifier_type = match dep.kind {
          DependencyKind::Require => SpecifierType::Commonjs,
          _ => SpecifierType::Esm,
        };
        d.priority = match dep.kind {
          DependencyKind::DynamicImport => Priority::Lazy,
          _ => Priority::Sync,
        };
        d.env = env_id;
        d.flags = flags;
        d.resolve_from = resolve_from;
        d.range = range;
        d.placeholder = dep.placeholder.map(|s| s.into());
        d.import_attributes = import_attributes;
        d.loc = Some(loc.clone());

        let placeholder = d.placeholder.unwrap_or(d.specifier);
        dep_map.insert(placeholder, d);
      }
    }
  }

  if result.needs_esm_helpers {
    let mut d = Dependency::new(
      "@parcel/transformer-js/src/esmodule-helpers.js".into(),
      asset_id,
    );
    d.flags = dep_flags;
    d.resolve_from = Some(to_project_path(
      &config.resolve_helpers_from,
      &db.options.project_root,
    ));
    d.env = db.environment_id(&Environment {
      include_node_modules: InternedString::from("{\"@parcel/transformer-js\":true}"),
      ..env.clone()
    });

    dep_map.insert(d.specifier, d);
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
        loc: Some(convert_loc(file_path, &s.loc, &mut map)),
        flags,
      };
      symbols.push(sym);
    }

    for s in hoist_result.imported_symbols {
      if let Some(dep) = InternedString::get(&*s.source).and_then(|s| dep_map.get_mut(&s)) {
        dep.symbols.push(Symbol {
          exported: s.imported.as_ref().into(),
          local: s.local.as_ref().into(),
          loc: Some(convert_loc(file_path, &s.loc, &mut map)),
          flags: SymbolFlags::empty(),
        });
      }
    }

    for s in hoist_result.re_exports {
      if let Some(dep) = InternedString::get(&*s.source).and_then(|s| dep_map.get_mut(&s)) {
        if &*s.local == "*" && &*s.imported == "*" {
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: Some(convert_loc(file_path, &s.loc, &mut map)),
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
            loc: Some(convert_loc(file_path, &s.loc, &mut map)),
            flags: SymbolFlags::IS_WEAK,
          });
          symbols.push(Symbol {
            exported: s.local.as_ref().into(),
            local: re_export_name,
            loc: Some(convert_loc(file_path, &s.loc, &mut map)),
            flags: SymbolFlags::empty(),
          });
        }
      }
    }

    for specifier in hoist_result.wrapped_requires {
      if let Some(dep) = InternedString::get(&specifier).and_then(|s| dep_map.get_mut(&s)) {
        dep.flags |= DependencyFlags::SHOULD_WRAP;
      }
    }

    for (name, specifier) in hoist_result.dynamic_imports {
      if let Some(dep) = InternedString::get(&*specifier).and_then(|s| dep_map.get_mut(&s)) {
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
      let mut d = Dependency::new(asset.id, asset_id);
      d.flags = dep_flags;
      d.symbols = dep_symbols;
      dep_map.insert(d.specifier, d);
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
          .and_then(|s| InternedString::get(&*s))
          .and_then(|s| dep_map.get_mut(&s))
        {
          let local = format!("${:016x}${}", dep.get_id_hash(), sym.local).into();
          dep.symbols.push(Symbol {
            exported: sym.local.as_ref().into(),
            local,
            loc: Some(convert_loc(file_path, &sym.loc, &mut map)),
            flags: SymbolFlags::IS_WEAK,
          });
          local
        } else {
          format!("${}", sym.local).into()
        };

        symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: Some(convert_loc(file_path, &sym.loc, &mut map)),
          flags: SymbolFlags::empty(),
        });
      }

      for sym in symbol_result.imports {
        if let Some(dep) = InternedString::get(&*sym.source).and_then(|s| dep_map.get_mut(&s)) {
          dep.symbols.push(Symbol {
            exported: sym.imported.as_ref().into(),
            local: sym.local.as_ref().into(),
            loc: Some(convert_loc(file_path, &sym.loc, &mut map)),
            flags: SymbolFlags::empty(),
          });
        }
      }

      for sym in symbol_result.exports_all {
        if let Some(dep) = InternedString::get(&*sym.source).and_then(|s| dep_map.get_mut(&s)) {
          dep.symbols.push(Symbol {
            exported: "*".into(),
            local: "*".into(),
            loc: Some(convert_loc(file_path, &sym.loc, &mut map)),
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
          local: format!("${}$", dep.placeholder.unwrap_or(dep.specifier)).into(),
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
    asset.unique_key = Some(asset.id);
  }

  let deps = dep_map.into_values().map(|dep| dep.commit()).collect();

  TransformResult2 {
    code: result.code,
    map: result.map,
    shebang: result.shebang,
    dependencies: deps,
    diagnostics: result.diagnostics,
    used_env: result.used_env.into_iter().map(|v| v.to_string()).collect(),
    invalidate_on_file_change,
  }
}

fn convert_loc(
  file_path: InternedString,
  loc: &parcel_js_swc_core::SourceLocation,
  map: &mut Option<SourceMap>,
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

  if let Some(map) = map {
    remap_source_location(&mut loc, map);
  }

  loc
}

fn remap_source_location(loc: &mut SourceLocation, map: &mut SourceMap) {
  let line_diff = loc.end.line - loc.start.line;
  let col_diff = loc.end.column - loc.start.column;

  let start = map.find_closest_mapping(loc.start.line - 1, loc.start.column - 1);
  let end = map.find_closest_mapping(loc.end.line - 1, loc.end.column - 1);

  if let Some(start) = start {
    if let Some(original) = start.original {
      if let Ok(source) = map.get_source(original.source) {
        loc.file_path = source.into();
      }

      loc.start.line = original.original_line + 1;
      loc.start.column = original.original_column + 1; // source map columns are 0-based
    }
  }

  if let Some(end) = end {
    if let Some(original) = end.original {
      loc.end.line = original.original_line + 1;
      loc.end.column = original.original_column + 1; // source map columns are 0-based

      if loc.end.line < loc.start.line {
        loc.end.line = loc.start.line;
        loc.end.column = loc.start.column;
      } else if loc.end.line == loc.start.line
        && loc.end.column < loc.start.column
        && line_diff == 0
      {
        loc.end.column = loc.start.column + col_diff;
      } else if loc.end.line == loc.start.line
        && loc.start.column == loc.end.column
        && line_diff == 0
      {
        // Prevent 0-length ranges
        loc.end.column = loc.start.column + 1;
      }

      return;
    }
  }

  loc.end.line = loc.start.line;
  loc.end.column = loc.start.column;
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
