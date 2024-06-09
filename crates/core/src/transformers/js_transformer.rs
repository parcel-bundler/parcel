use std::borrow::Cow;
use std::path::{Path, PathBuf};

use indexmap::{indexmap, IndexMap};
use parcel_js_swc_core::{Config, DependencyKind, TransformResult, Version, Versions};
use parcel_resolver::package_json::{AliasValue, BrowserField};
use parcel_resolver::{
  CacheCow, ExportsCondition, IncludeNodeModules, InlineEnvironment, Invalidations, Specifier,
};

use crate::diagnostic::{CodeFrame, CodeHighlight, Diagnostic, DiagnosticSeverity};
use crate::environment::{
  Environment, EnvironmentContext, EnvironmentFeature, EnvironmentFlags, OutputFormat, SourceType,
};
use crate::intern::Interned;
use crate::requests::asset_request::{Transformer, TransformerResult};
use crate::types::{
  Asset, AssetFlags, AssetType, BuildMode, BundleBehavior, Dependency, DependencyFlags,
  ImportAttribute, JSONObject, Location, LogLevel, ParcelOptions, Priority, SourceLocation,
  SpecifierType, Symbol, SymbolFlags,
};

pub struct JsTransformer;

impl Transformer for JsTransformer {
  fn transform(
    &self,
    asset: Asset,
    code: Vec<u8>,
    _farm: &crate::worker_farm::WorkerFarm,
    options: &ParcelOptions,
  ) -> Result<TransformerResult, Vec<Diagnostic>> {
    let config = config(&asset, code, options);
    match parcel_js_swc_core::transform(&config, None) {
      Ok(res) => {
        if let Some(diagnostics) = res.diagnostics {
          Err(convert_diagnostics(&asset, diagnostics))
        } else {
          convert_result(asset, None, &config, res, options)
        }
      }
      Err(err) => todo!(),
    }
  }
}

fn convert_version(version: &crate::environment::Version) -> Version {
  Version {
    major: version.major() as u32,
    minor: version.minor() as u32,
    patch: 0,
  }
}

#[inline]
fn config<'a>(asset: &Asset, code: Vec<u8>, options: &'a ParcelOptions) -> Config<'a> {
  let mut targets = None;
  if asset.env.context.is_electron() {
    if let Some(electron) = &asset.env.engines.electron {
      targets = Some(Versions {
        electron: Some(convert_version(electron)),
        ..Default::default()
      });
    }
  } else if asset.env.context.is_browser() {
    let browsers = &asset.env.engines.browsers;
    let mut versions = Versions::default();
    versions.android = browsers.android.as_ref().map(convert_version);
    versions.chrome = browsers.chrome.as_ref().map(convert_version);
    versions.edge = browsers.edge.as_ref().map(convert_version);
    versions.firefox = browsers.firefox.as_ref().map(convert_version);
    versions.ie = browsers.ie.as_ref().map(convert_version);
    versions.ios = browsers.ios_saf.as_ref().map(convert_version);
    versions.opera = browsers.opera.as_ref().map(convert_version);
    versions.safari = browsers.safari.as_ref().map(convert_version);
    versions.samsung = browsers.samsung.as_ref().map(convert_version);
    if !versions.is_any_target() {
      targets = Some(versions);
    }
  } else if asset.env.context.is_node() {
    if let Some(node) = &asset.env.engines.node {
      targets = Some(Versions {
        node: Some(convert_version(node)),
        ..Default::default()
      });
    }
  }

  let resolver = parcel_resolver::Resolver::parcel(
    Cow::Borrowed(&options.project_root),
    CacheCow::Borrowed(&options.resolver_cache),
  );

  let invalidations = Invalidations::default();
  let pkg = resolver.find_package(&asset.file_path, &invalidations);
  let mut react_refresh = false;
  let mut jsx_pragma = None;
  let mut jsx_pragma_frag = None;
  let mut jsx_import_source = None;
  let mut automatic_jsx_runtime = false;
  let mut is_jsx = false;
  let mut decorators = false;
  let mut use_define_for_class_fields = false;
  if asset.flags.contains(AssetFlags::IS_SOURCE) {
    let mut react_lib = None;
    if let Ok(Some(pkg)) = pkg {
      if pkg
        .alias
        .contains_key(&Specifier::Package("react".into(), "".into()))
      {
        // e.g.: `{ alias: { "react": "preact/compat" } }`
        react_lib = Some("react");
      } else {
        for lib in &["react", "preact", "nervejs", "hyperapp"] {
          if pkg.has_dependency(lib) {
            react_lib = Some(lib);
          }
        }
      }

      // TODO: hmrOptions
      react_refresh = options.mode == BuildMode::Development && pkg.has_dependency("react");
    }

    if let Ok(Some(tsconfig)) = resolver.find_tsconfig(&options.project_root, &invalidations) {
      jsx_pragma = tsconfig.jsx_factory.or_else(|| match react_lib {
        Some("react") => Some("React.createElement"),
        Some("preact") => Some("h"),
        Some("nervjs") => Some("Nerv.createElement"),
        Some("hyperapp") => Some("h"),
        _ => None,
      });

      jsx_pragma_frag = tsconfig.jsx_fragment_factory.or_else(|| match react_lib {
        Some("react") => Some("React.Fragment"),
        Some("preact") => Some("Fragment"),
        _ => None,
      });

      if matches!(
        tsconfig.jsx,
        Some(
          parcel_resolver::tsconfig::Jsx::ReactJsx | parcel_resolver::tsconfig::Jsx::ReactJsxdev
        )
      ) || tsconfig.jsx_import_source.is_some()
      {
        jsx_import_source = tsconfig.jsx_import_source.clone();
        automatic_jsx_runtime = true;
      } else if let Some(react_lib) = react_lib {
        if let Ok(Some(pkg)) = pkg {
          let effective_react_lib = if pkg
            .alias
            .get(&Specifier::Package("react".into(), "".into()))
            == Some(&AliasValue::Specifier(Specifier::Package(
              "preact".into(),
              "".into(),
            ))) {
            "preact"
          } else {
            react_lib
          };

          let automatic_range = match effective_react_lib {
            "react" => Some(
              node_semver::Range::parse(">= 17.0.0 || ^16.14.0 || >= 0.0.0-0 < 0.0.0").unwrap(),
            ),
            "preact" => Some(node_semver::Range::parse(">= 10.5.0").unwrap()),
            _ => None,
          };

          if let Some(min_version) = pkg
            .get_dependency_version(effective_react_lib)
            .and_then(|v| node_semver::Range::parse(v).ok())
            .and_then(|r| r.min_version())
          {
            automatic_jsx_runtime = tsconfig.jsx_factory.is_none()
              && matches!(automatic_range, Some(automatic_range) if min_version.satisfies(&automatic_range));
          }

          if automatic_jsx_runtime {
            jsx_import_source = Some(react_lib);
          }
        }
      }

      is_jsx = tsconfig.jsx.is_some() || jsx_pragma.is_some();
      decorators = tsconfig.experimental_decorators;
      use_define_for_class_fields = tsconfig.use_define_for_class_fields == Some(true);

      if tsconfig.use_define_for_class_fields.is_none() {
        if let Some(target) = tsconfig.target {
          if target == "esnext" {
            use_define_for_class_fields = true;
          } else if let Ok(target) = &target[2..].parse::<u32>() {
            use_define_for_class_fields = *target >= 2022;
          }
        }
      }
    }
  }

  let mut inline_fs = true;

  // Check if we should ignore fs calls
  // See https://github.com/defunctzombie/node-browser-resolve#skip
  if let Ok(Some(pkg)) = pkg {
    if let BrowserField::Map(browser) = &pkg.browser {
      if browser.get(&Specifier::Package("fs".into(), "".into())) == Some(&AliasValue::Bool(false))
      {
        inline_fs = false;
      }
    }
  }

  let mut inline_env = InlineEnvironment::Bool(asset.flags.contains(AssetFlags::IS_SOURCE));
  let mut inline_constants = false;
  if let Ok(Some(root_pkg)) = resolver.find_package(&options.project_root, &invalidations) {
    if let Some(config) = &root_pkg.js_transformer_config {
      if let Some(inline_environment) = &config.inline_environment {
        inline_env = inline_environment.clone(); // TODO: we could borrow here
      }

      if let Some(fs) = config.inline_fs {
        inline_fs = fs;
      }

      inline_constants = config.inline_constants;
    }
  }

  Config {
    filename: (*asset.file_path).clone(),
    code,
    module_id: format!("{:016x}", asset.id()),
    project_root: Cow::Borrowed(&options.project_root),
    replace_env: !asset.env.context.is_node(),
    env: Cow::Borrowed(&options.env),
    inline_env: Cow::Owned(inline_env),
    inline_fs,
    insert_node_globals: !asset.env.context.is_node()
      && asset.env.source_type != SourceType::Script,
    node_replacer: asset.env.context.is_node(),
    is_browser: asset.env.context.is_browser(),
    is_worker: asset.env.context.is_worker(),
    is_type_script: matches!(asset.asset_type, AssetType::Ts | AssetType::Tsx),
    is_jsx,
    jsx_pragma: jsx_pragma.map(|s| s.to_string()),
    jsx_pragma_frag: jsx_pragma_frag.map(|s| s.to_string()),
    automatic_jsx_runtime,
    jsx_import_source: jsx_import_source.map(|s| s.to_string()),
    decorators,
    use_define_for_class_fields,
    is_development: options.mode == BuildMode::Development,
    react_refresh,
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
    supports_module_workers: asset.env.engines.supports(EnvironmentFeature::WorkerModule),
    is_library: asset.env.flags.contains(EnvironmentFlags::IS_LIBRARY),
    is_esm_output: asset.env.output_format == OutputFormat::Esmodule,
    trace_bailouts: options.log_level == LogLevel::Verbose,
    is_swc_helpers: asset
      .file_path
      .to_str()
      .unwrap_or("")
      .contains("@swc/helpers"),
    standalone: asset
      .query
      .as_ref()
      .map_or(false, |q| q.contains("standalone=true")), // TODO: use a real parser
    inline_constants,
  }
}

fn convert_result(
  mut asset: Asset,
  map_buf: Option<&[u8]>,
  config: &Config,
  result: TransformResult,
  options: &ParcelOptions,
) -> Result<TransformerResult, Vec<Diagnostic>> {
  let file_path = asset.file_path;
  let env = asset.env;
  let asset_id = asset.id();

  asset
    .meta
    .insert("id".into(), format!("{:016x}", asset_id).into());

  if let Some(shebang) = result.shebang {
    asset.meta.insert("interpreter".into(), shebang.into());
  }

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
    let loc = convert_loc(file_path, &dep.loc);
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
            ..(*env).clone()
          }
          .into(),
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
          meta: JSONObject::new(),
          resolver_meta: JSONObject::new(),
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
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
            ..(*env).clone()
          }
          .into(),
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
          meta: JSONObject::new(),
          resolver_meta: JSONObject::new(),
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
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
            output_format: OutputFormat::Esmodule,
            loc: Some(loc.clone()),
            ..(*env).clone()
          }
          .into(),
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
          meta: JSONObject::new(),
          resolver_meta: JSONObject::new(),
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
      DependencyKind::Url => {
        let d = Dependency {
          source_asset_id: Some(format!("{:016x}", asset_id)),
          specifier: dep.specifier.as_ref().into(),
          specifier_type: SpecifierType::Url,
          source_path: Some(file_path.clone()),
          env,
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
          meta: JSONObject::new(),
          resolver_meta: JSONObject::new(),
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

        let mut env = env;
        if dep.kind == DependencyKind::DynamicImport {
          // https://html.spec.whatwg.org/multipage/webappapis.html#hostimportmoduledynamically(referencingscriptormodule,-modulerequest,-promisecapability)
          if matches!(
            env.context,
            EnvironmentContext::Worklet | EnvironmentContext::ServiceWorker
          ) {
            let mut diagnostic = Diagnostic {
              origin: Some("@parcel/transformer-js".into()),
              message: format!(
                "import() is not allowed in {}.",
                match env.context {
                  EnvironmentContext::Worklet => "worklets",
                  EnvironmentContext::ServiceWorker => "service workers",
                  _ => unreachable!(),
                }
              ),
              code_frames: vec![CodeFrame {
                file_path: Some(asset.file_path),
                code: None,
                language: None,
                code_highlights: vec![CodeHighlight::from_loc(
                  &convert_loc(asset.file_path, &dep.loc),
                  None,
                )],
              }],
              hints: vec!["Try using a static `import`.".into()],
              severity: DiagnosticSeverity::Error,
              documentation_url: None,
            };
            environment_diagnostic(&mut diagnostic, &asset, false);
            return Err(vec![diagnostic]);
          }

          // If all of the target engines support dynamic import natively,
          // we can output native ESM if scope hoisting is enabled.
          // Only do this for scripts, rather than modules in the global
          // output format so that assets can be shared between the bundles.
          let mut output_format = env.output_format;
          if env.source_type == SourceType::Script
            && env.flags.contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
            && env.engines.supports(EnvironmentFeature::DynamicImport)
          {
            output_format = OutputFormat::Esmodule;
          }

          if env.source_type != SourceType::Module || env.output_format != output_format {
            env = Environment {
              source_type: SourceType::Module,
              output_format,
              loc: Some(loc.clone()),
              ..(*env).clone()
            }
            .into();
          }
        }

        // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
        let is_helper = dep.is_helper
          && !(dep.specifier.ends_with("/jsx-runtime")
            || dep.specifier.ends_with("/jsx-dev-runtime"));
        if is_helper && !env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          env = Environment {
            include_node_modules: IncludeNodeModules::Bool(true),
            ..(*env).clone()
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

          resolve_from = Some(options.core_path.as_path().into());
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
          meta: JSONObject::new(),
          resolver_meta: JSONObject::new(),
          package_conditions: ExportsCondition::empty(),
          custom_package_conditions: Vec::new(),
        };

        dep_map.insert(placeholder, d);
      }
    }
  }

  if result.needs_esm_helpers {
    let d = Dependency {
      source_asset_id: Some(format!("{:016x}", asset_id)),
      specifier: "@parcel/transformer-js/src/esmodule-helpers.js".into(),
      specifier_type: SpecifierType::Esm,
      source_path: Some(file_path.clone()),
      env: Environment {
        include_node_modules: IncludeNodeModules::Map(indexmap! {
          "@parcel/transformer-js".into() => true
        }),
        ..(*env).clone()
      }
      .into(),
      resolve_from: Some(options.core_path.as_path().into()),
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
      meta: JSONObject::new(),
      resolver_meta: JSONObject::new(),
      package_conditions: ExportsCondition::empty(),
      custom_package_conditions: Vec::new(),
    };

    dep_map.insert(d.specifier.as_str().into(), d);
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
        && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
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
      asset.flags |= AssetFlags::HAS_SYMBOLS;
      symbols.reserve(symbol_result.exports.len() + 1);
      for sym in &symbol_result.exports {
        let (local, flags) = if let Some(dep) = sym
          .source
          .as_ref()
          .and_then(|source| dep_map.get_mut(source))
        {
          let local = format!("${:016x}${}", dep.id(), sym.local).into();
          dep.symbols.push(Symbol {
            exported: sym.local.as_ref().into(),
            local: local,
            loc: Some(convert_loc(file_path, &sym.loc)),
            flags: SymbolFlags::IS_WEAK,
          });
          (local, SymbolFlags::IS_WEAK)
        } else {
          (format!("${}", sym.local).into(), SymbolFlags::empty())
        };

        symbols.push(Symbol {
          exported: sym.exported.as_ref().into(),
          local,
          loc: Some(convert_loc(file_path, &sym.loc)),
          flags,
        });
      }

      for sym in symbol_result.imports {
        if let Some(dep) = dep_map.get_mut(&sym.source) {
          dep.symbols.push(Symbol {
            exported: sym.imported.as_ref().into(),
            local: sym.local.as_ref().into(),
            loc: Some(convert_loc(file_path, &sym.loc)),
            flags: SymbolFlags::empty(),
          });
        }
      }

      for sym in symbol_result.exports_all {
        if let Some(dep) = dep_map.get_mut(&sym.source) {
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
          && asset.flags.contains(AssetFlags::SIDE_EFFECTS)
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
          local: format!("${}$", dep.placeholder.as_ref().unwrap_or(&dep.specifier)).into(),
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
    asset.unique_key = Some(format!("{:016x}", asset_id));
  }

  asset.asset_type = AssetType::Js;
  Ok(TransformerResult {
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
  })
}

fn convert_loc(
  file_path: Interned<PathBuf>,
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

fn convert_diagnostics(
  asset: &Asset,
  diagnostics: Vec<parcel_js_swc_core::Diagnostic>,
) -> Vec<Diagnostic> {
  diagnostics
    .into_iter()
    .map(|d| {
      let mut diagnostic = Diagnostic {
        origin: Some("@parcel/transformer-js".into()),
        message: match d.message.as_str() {
          "SCRIPT_ERROR" => {
            match asset.env.context {
              EnvironmentContext::WebWorker => "Web workers cannot have imports or exports without the `type: \"module\"` option.".into(),
              EnvironmentContext::ServiceWorker => "Service workers cannot have imports or exports without the `type: \"module\"` option.".into(),
              EnvironmentContext::Browser | _ => "Browser scripts cannot have imports or exports.".into(),
            }
          }
          _ => d.message
        },
        code_frames: vec![CodeFrame {
          file_path: Some(asset.file_path),
          code: None,
          language: None,
          code_highlights: d
            .code_highlights
            .unwrap_or_default()
            .iter()
            .map(|h| CodeHighlight::from_loc(&convert_loc(asset.file_path, &h.loc), h.message.clone()))
            .collect(),
        }],
        hints: d.hints.unwrap_or_default(),
        documentation_url: d.documentation_url.clone(),
        severity: match d.severity {
          parcel_js_swc_core::DiagnosticSeverity::Error => DiagnosticSeverity::Error,
          parcel_js_swc_core::DiagnosticSeverity::SourceError => DiagnosticSeverity::SourceError,
          parcel_js_swc_core::DiagnosticSeverity::Warning => DiagnosticSeverity::Warning,
        },
      };

      if d.show_environment {
        environment_diagnostic(&mut diagnostic, asset, true);
      }
      diagnostic
    })
    .collect()
}

fn environment_diagnostic(diagnostic: &mut Diagnostic, asset: &Asset, show_hint: bool) {
  if let Some(loc) = &asset.env.loc {
    if loc.file_path != asset.file_path {
      diagnostic.code_frames.push(CodeFrame {
        code: None,
        file_path: Some(loc.file_path),
        language: None,
        code_highlights: vec![CodeHighlight::from_loc(
          loc,
          Some("The environment was originally created here".into()),
        )],
      });
    }
  }

  if show_hint {
    match asset.env.context {
      EnvironmentContext::Browser => {
        diagnostic
          .hints
          .push("Add the type=\"module\" attribute to the <script> tag.".into());
      }
      EnvironmentContext::WebWorker => {
        diagnostic
          .hints
          .push("Add {type: 'module'} as a second argument to the Worker constructor.".into());
      }
      EnvironmentContext::ServiceWorker => {
        diagnostic.hints.push(
          "Add {type: 'module'} as a second argument to the navigator.serviceWorker.register() call."
            .into(),
        );
      }
      _ => {}
    }
  }
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
