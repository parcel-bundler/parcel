use std::{
  borrow::Cow,
  cell::RefCell,
  collections::HashMap,
  fmt::Write,
  sync::{Arc, Mutex},
};

use glob_match::glob_match;
use indexmap::{IndexMap, IndexSet};
use parcel_core::*;
use parcel_js_swc_core::{
  Ast, Config, DependencyKind, EnvContext, Type, Version, Versions, transform_to_ast,
  tree_shake::tree_shake,
};
use parcel_plugin_js::call_macro;
use parcel_resolver::{AliasValue, BrowserField, InlineEnvironment, Invalidations, Specifier};

use parcel_css::resolve_css_module_export;

pub use parcel_js_swc_core::tree_shake::Resolution;

struct JsContent {
  ast: Mutex<Ast>,
  shebang: Option<String>,
  directives: Vec<String>,
}

impl std::fmt::Debug for JsContent {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "JsContent")
  }
}

impl Content for JsContent {
  fn read(&self) -> Result<Vec<u8>, Diagnostic> {
    let (code, _) = self.ast.lock().unwrap().to_code(false, false)?;
    Ok(code)
  }
}

pub struct JsTransformer {}

impl Transformer for JsTransformer {
  fn transform(&self, mut asset: Asset, options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    let config = config(&mut asset, options);
    let resolver = parcel_resolver::Resolver::parcel(
      &options.project_root.to_file_path().unwrap(),
      parcel_resolver::Cache::new(options.input_fs.clone()),
    );

    let url = asset.loc.url.clone();
    let env = asset.target.clone();
    let resolve_from = asset.loc.url.to_file_path().unwrap();
    let macro_deps = Arc::new(RefCell::new(Vec::new()));
    let macro_deps_cloned = macro_deps.clone();
    let res = transform_to_ast(
      config,
      Some(Arc::new(move |src, export, args, loc| {
        let resolved = resolver.resolve(&src, &resolve_from, parcel_resolver::SpecifierType::Esm);
        if let Ok(res) = resolved.result {
          if let parcel_resolver::Resolution::Path(p) = res.resolution {
            let (res, deps) = call_macro(
              url.clone(),
              env.clone(),
              p.to_str().unwrap().to_string(),
              export,
              args,
              loc,
            )?;
            macro_deps_cloned.borrow_mut().extend(deps);
            return Ok(res);
          }
        }

        todo!()
      })),
    )?;

    if let Some(diagnostics) = res.diagnostics {
      let diagnostics: Vec<Diagnostic> = diagnostics
        .into_iter()
        .filter(|d| d.severity == parcel_js_swc_core::DiagnosticSeverity::Error)
        .map(|d| Diagnostic {
          origin: Some("@parcel/transformer-js".into()),
          message: d.message,
          code_frames: vec![CodeFrame {
            url: Some(asset.loc.url.clone()),
            code: None,
            language: Some(asset.ty.clone()),
            code_highlights: d
              .code_highlights
              .unwrap_or(vec![])
              .into_iter()
              .map(|h| CodeHighlight {
                message: h.message,
                start: Location {
                  line: h.loc.start_line as u32,
                  column: h.loc.end_col as u32,
                },
                end: Location {
                  line: h.loc.end_line as u32,
                  column: h.loc.end_col as u32,
                },
              })
              .collect(),
          }],
          hints: vec![],
          severity: parcel_core::DiagnosticSeverity::Error,
          documentation_url: None,
        })
        .collect();
      if !diagnostics.is_empty() {
        return Err(DiagnosticList(diagnostics));
      }
    }

    asset.ty = AssetType::Js;
    asset.content = Arc::new(JsContent {
      ast: Mutex::new(res.ast),
      shebang: res.shebang,
      directives: res.directives.into_iter().map(|d| d.to_string()).collect(),
    });

    let mut dep_map = HashMap::new();
    for dep in res.dependencies {
      let is_helper = dep
        .flags
        .contains(parcel_js_swc_core::DependencyFlags::HELPER)
        && !(dep.specifier.ends_with("/jsx-runtime")
          || dep.specifier.ends_with("/jsx-dev-runtime"));

      dep_map.insert(
        dep
          .placeholder
          .as_ref()
          .map_or_else(|| dep.specifier.clone(), |v| v.clone().into()),
        asset.dependencies.len() as u32,
      );

      asset.dependencies.push(Dependency {
        specifier: dep.specifier.to_string(),
        specifier_type: match dep.kind {
          DependencyKind::Import | DependencyKind::Export | DependencyKind::DynamicImport => {
            SpecifierType::Esm
          }
          DependencyKind::Require => SpecifierType::Commonjs,
          DependencyKind::WebWorker
          | DependencyKind::ServiceWorker
          | DependencyKind::Worklet
          | DependencyKind::Url => SpecifierType::Url,
          DependencyKind::File | DependencyKind::Id => SpecifierType::Custom, // TODO
        },
        priority: match dep.kind {
          DependencyKind::DynamicImport
          | DependencyKind::WebWorker
          | DependencyKind::ServiceWorker
          | DependencyKind::Worklet
          | DependencyKind::Url => Priority::Lazy,
          _ => Priority::Sync,
        },
        bundle_behavior: match dep.kind {
          DependencyKind::Url
          | DependencyKind::WebWorker
          | DependencyKind::ServiceWorker
          | DependencyKind::Worklet => BundleBehavior::Isolated,
          _ => BundleBehavior::None,
        },
        flags: {
          let mut flags = DependencyFlags::empty();
          if dep
            .flags
            .contains(parcel_js_swc_core::DependencyFlags::OPTIONAL)
          {
            flags |= DependencyFlags::OPTIONAL;
          }
          if dep.kind == DependencyKind::WebWorker {
            flags |= DependencyFlags::IS_WEBWORKER;
          }
          flags
        },
        target: match dep.kind {
          DependencyKind::WebWorker => {
            // Use native ES module output if the worker was created with `type: 'module'` and all targets
            // support native module workers. Only do this if parent asset output format is also esmodule so that
            // assets can be shared between workers and the main thread in the global output format.
            let mut output_format = asset.target.output_format;
            if output_format == OutputFormat::Esmodule
              && dep.source_type == Some(parcel_js_swc_core::SourceType::Module)
              && asset
                .target
                .engines
                .supports(EnvironmentFeature::WorkerModule)
            {
              output_format = OutputFormat::Esmodule;
            } else if output_format != OutputFormat::Commonjs {
              output_format = OutputFormat::Global;
            }

            Arc::new(Target {
              environment: Environment::WebWorker,
              source_type: match dep.source_type {
                Some(parcel_js_swc_core::SourceType::Module) => SourceType::Module,
                _ => SourceType::Script,
              },
              output_format,
              loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
              ..(*asset.target).clone()
            })
          }
          DependencyKind::ServiceWorker => Arc::new(Target {
            environment: Environment::ServiceWorker,
            source_type: match dep.source_type {
              Some(parcel_js_swc_core::SourceType::Module) => SourceType::Module,
              _ => SourceType::Script,
            },
            output_format: OutputFormat::Global,
            loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
            ..(*asset.target).clone()
          }),
          DependencyKind::Worklet => Arc::new(Target {
            environment: Environment::Worklet,
            source_type: SourceType::Module,
            output_format: OutputFormat::Esmodule,
            loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
            ..(*asset.target).clone()
          }),
          DependencyKind::DynamicImport => {
            // If all of the target engines support dynamic import natively,
            // we can output native ESM if scope hoisting is enabled.
            // Only do this for scripts, rather than modules in the global
            // output format so that assets can be shared between the bundles.
            let mut output_format = asset.target.output_format;
            if asset.target.source_type == SourceType::Script
              && asset
                .target
                .flags
                .contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
              && asset
                .target
                .engines
                .supports(EnvironmentFeature::DynamicImport)
            {
              output_format = OutputFormat::Esmodule;
            }

            if asset.target.source_type != SourceType::Module
              || asset.target.output_format != output_format
            {
              Arc::new(Target {
                source_type: SourceType::Module,
                output_format,
                loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
                ..(*asset.target).clone()
              })
            } else {
              asset.target.clone()
            }
          }
          DependencyKind::Url | DependencyKind::File | DependencyKind::Id => asset.target.clone(),
          DependencyKind::Import | DependencyKind::Export | DependencyKind::Require => {
            // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
            if is_helper && !asset.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
              Arc::new(Target {
                include_node_modules: IncludeNodeModules::Bool(true),
                ..(*asset.target).clone()
              })
            } else {
              asset.target.clone()
            }
          }
        },
        loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
        placeholder: dep.placeholder,
        resolve_from: if is_helper {
          // TODO
          Some(options.project_root.clone())
        } else {
          Some(asset.loc.url.clone())
        },
        range: if is_helper {
          // TODO: get versions from package.json? Can we do it at compile time?
          if dep.specifier.starts_with("@swc/helpers") {
            Some("^0.5.0".into())
          } else if dep.specifier.starts_with("regenerator-runtime") {
            Some("^0.13.7".into())
          } else {
            None
          }
        } else {
          None
        },
        conditions: match dep.kind {
          DependencyKind::Import | DependencyKind::Export | DependencyKind::DynamicImport => {
            ExportsCondition::IMPORT
          }
          DependencyKind::Require => ExportsCondition::REQUIRE,
          DependencyKind::WebWorker | DependencyKind::ServiceWorker => ExportsCondition::WORKER,
          DependencyKind::Worklet => ExportsCondition::WORKLET,
          _ => ExportsCondition::empty(),
        },
        resolution: DependencyResolution::None,
      })
    }

    if res.needs_esm_helpers {
      let index = asset.dependencies.len() as u32;
      asset.dependencies.push(Dependency {
        specifier: "@parcel/transformer-js/src/esmodule-helpers.js".into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        flags: DependencyFlags::empty(),
        target: Arc::new(Target {
          include_node_modules: IncludeNodeModules::Array(vec!["@parcel/transformer-js".into()]),
          ..(*asset.target).clone()
        }),
        loc: None,
        placeholder: None,
        resolve_from: Some(options.project_root.clone()), // TODO
        range: None,
        conditions: ExportsCondition::empty(),
        resolution: DependencyResolution::None,
      });

      asset.symbols.imports.push(ImportedSymbol {
        dep_index: index,
        symbol: SymbolName::Namespace,
        resolved: SymbolResolution::None,
      });
    }

    if let Some(symbols) = res.symbol_result {
      asset
        .flags
        .set(AssetFlags::HAS_CJS_EXPORTS, symbols.has_cjs_exports);
      asset
        .flags
        .set(AssetFlags::SHOULD_WRAP, symbols.should_wrap);

      for import in symbols.imports {
        let dep_index = dep_map[&import.source];
        asset.symbols.imports.push(ImportedSymbol {
          dep_index,
          symbol: SymbolName::from(import.imported.as_str()),
          resolved: SymbolResolution::None,
        });
      }

      asset
        .symbols
        .imports
        .sort_by(|a, b| a.dep_index.cmp(&b.dep_index));

      for export in symbols.exports {
        if let Some(source) = export.source {
          let dep_index = dep_map[&source];
          asset.symbols.indirect.push(IndirectSymbol {
            exported: SymbolName::from(export.exported.as_str()),
            dep_index,
            imported: SymbolName::from(export.local.as_str()),
            requested: false,
          });
        } else {
          asset.symbols.exports.push(LocalSymbol {
            exported: SymbolName::from(export.exported.as_str()),
            requested: false,
          });
        }
      }

      for star in symbols.exports_all {
        let dep_index = dep_map[&star.source];
        asset.symbols.star.push(StarSymbol {
          dep_index,
          requested: false,
        });
      }
    } else {
      // Could not statically analyze symbols. Assume everything is imported.
      for (dep_index, dep) in asset.dependencies.iter().enumerate() {
        if matches!(
          dep.specifier_type,
          SpecifierType::Esm | SpecifierType::Commonjs
        ) {
          asset.symbols.imports.push(ImportedSymbol {
            dep_index: dep_index as u32,
            symbol: SymbolName::Namespace,
            resolved: SymbolResolution::None,
          });
        }
      }
    }

    asset
      .dependencies
      .extend(std::mem::take(&mut *macro_deps.borrow_mut()));
    Ok(asset)
  }
}

fn convert_loc(
  url: SourceUrl,
  loc: &parcel_js_swc_core::SourceLocation,
  // map: &mut Option<SourceMap>,
) -> SourceLocation {
  let loc = SourceLocation {
    url,
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

fn convert_version(version: &parcel_core::Version) -> Version {
  Version {
    major: version.major() as u32,
    minor: version.minor() as u32,
    patch: 0,
  }
}

fn config(asset: &mut Asset, options: &ParcelOptions) -> Config {
  let mut targets = None;
  if asset.target.environment.is_electron() {
    if let Some(electron) = &asset.target.engines.electron {
      targets = Some(Versions {
        electron: Some(convert_version(electron)),
        ..Default::default()
      });
    }
  } else if asset.target.environment.is_browser() {
    let browsers = &asset.target.engines.browsers;
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
  } else if asset.target.environment.is_node() {
    if let Some(node) = &asset.target.engines.node {
      targets = Some(Versions {
        node: Some(convert_version(node)),
        ..Default::default()
      });
    }
  }

  let resolver = parcel_resolver::Resolver::parcel(
    &options.project_root.to_file_path().unwrap(),
    parcel_resolver::Cache::new(options.input_fs.clone()),
  );

  let invalidations = Invalidations::default();
  let pkg = resolver.find_package(
    &resolver.cache().get(asset.loc.url.to_file_path().unwrap()),
    &invalidations,
  );
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
    if let Some(pkg) = &pkg {
      if let Ok(pkg) = &**pkg {
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
    }

    let mut tsconfig_jsx = None;
    let mut tsconfig_jsx_import_source = None;
    let mut tsconfig_jsx_factory = None;
    if let Some(tsconfig) = resolver.find_tsconfig(
      &resolver
        .cache()
        .get(options.project_root.to_file_path().unwrap()),
      &invalidations,
    ) {
      if let Ok(tsconfig) = &*tsconfig {
        jsx_pragma = tsconfig.compiler_options.jsx_factory.clone();
        jsx_pragma_frag = tsconfig.compiler_options.jsx_fragment_factory.clone();

        tsconfig_jsx = tsconfig.compiler_options.jsx;
        tsconfig_jsx_import_source = tsconfig.compiler_options.jsx_import_source.clone();
        tsconfig_jsx_factory = tsconfig.compiler_options.jsx_factory.clone();
        decorators = tsconfig.compiler_options.experimental_decorators;
        use_define_for_class_fields =
          tsconfig.compiler_options.use_define_for_class_fields == Some(true);

        if tsconfig
          .compiler_options
          .use_define_for_class_fields
          .is_none()
        {
          if let Some(target) = &tsconfig.compiler_options.target {
            if target == "esnext" {
              use_define_for_class_fields = true;
            } else if let Ok(target) = &target[2..].parse::<u32>() {
              use_define_for_class_fields = *target >= 2022;
            }
          }
        }
      }
    }

    if jsx_pragma.is_none() {
      jsx_pragma = match react_lib {
        Some("react") => Some("React.createElement".into()),
        Some("preact") => Some("h".into()),
        Some("nervjs") => Some("Nerv.createElement".into()),
        Some("hyperapp") => Some("h".into()),
        _ => None,
      };
    }

    if jsx_pragma_frag.is_none() {
      jsx_pragma_frag = match react_lib {
        Some("react") => Some("React.Fragment".into()),
        Some("preact") => Some("Fragment".into()),
        _ => None,
      };
    }

    if matches!(
      tsconfig_jsx,
      Some(parcel_resolver::Jsx::ReactJsx | parcel_resolver::Jsx::ReactJsxdev)
    ) || tsconfig_jsx_import_source.is_some()
    {
      jsx_import_source = tsconfig_jsx_import_source.clone();
      automatic_jsx_runtime = true;
    } else if let Some(react_lib) = react_lib {
      if let Some(pkg) = &pkg {
        if let Ok(pkg) = &**pkg {
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
            automatic_jsx_runtime = tsconfig_jsx_factory.is_none()
              && matches!(automatic_range, Some(automatic_range) if min_version.satisfies(&automatic_range));
          }

          if automatic_jsx_runtime {
            jsx_import_source = Some(react_lib.into());
          }
        }
      }
    }

    is_jsx = tsconfig_jsx.is_some() || jsx_pragma.is_some();

    if asset.ty == AssetType::Ts {
      is_jsx = false;
    } else if !is_jsx {
      is_jsx = matches!(asset.ty, AssetType::Jsx | AssetType::Tsx);
    }
  }

  let mut inline_fs = true;

  // Check if we should ignore fs calls
  // See https://github.com/defunctzombie/node-browser-resolve#skip
  if let Some(pkg) = &pkg {
    if let Ok(pkg) = &**pkg {
      if let BrowserField::Map(browser) = &pkg.browser {
        if browser.get(&Specifier::Package("fs".into(), "".into()))
          == Some(&AliasValue::Bool(false))
        {
          inline_fs = false;
        }
      }
    }
  }

  let mut inline_constants = false;
  let mut inline_env = InlineEnvironment::default();
  if let Some(root_pkg) = resolver.find_package(
    &resolver
      .cache()
      .get(options.project_root.to_file_path().unwrap()),
    &invalidations,
  ) {
    if let Ok(root_pkg) = &*root_pkg {
      if let Some(config) = &root_pkg.js_transformer_config {
        if let Some(inline_environment) = &config.inline_environment {
          inline_env = inline_environment.clone();
        }

        if let Some(fs) = config.inline_fs {
          inline_fs = fs;
        }

        inline_constants = config.inline_constants;
      }
    }
  }

  let mut env = HashMap::new();
  match inline_env {
    InlineEnvironment::Bool(false) => {
      if let Some(node_env) = options.env.get("NODE_ENV") {
        env.insert("NODE_ENV".into(), node_env.as_str().into());
      }
    }
    InlineEnvironment::Bool(true) => {
      for (k, v) in &options.env {
        if !k.starts_with("npm_") {
          env.insert(k.as_str().into(), v.as_str().into());
        }
      }
    }
    InlineEnvironment::Array(keys) => {
      for (key, value) in &options.env {
        if keys.iter().any(|k| glob_match(k, key)) {
          env.insert(key.as_str().into(), value.as_str().into());
        }
      }
    }
  }

  Config {
    filename: asset.loc.url.to_string(),
    code: asset.content.read().unwrap(),
    module_id: asset.id(),
    project_root: options.project_root.to_string(),
    context: match &asset.target.environment {
      Environment::Browser => EnvContext::Browser,
      Environment::WebWorker => EnvContext::WebWorker,
      Environment::ServiceWorker => EnvContext::ServiceWorker,
      Environment::Worklet => EnvContext::Worklet,
      Environment::Node => EnvContext::Node,
      Environment::ElectronRenderer => EnvContext::ElectronRenderer,
      Environment::ElectronMain => EnvContext::ElectronMain,
      Environment::ReactClient => EnvContext::ReactClient,
      Environment::ReactServer => EnvContext::ReactServer,
    },
    asset_type: match asset.ty {
      AssetType::Ts => Type::Ts,
      AssetType::Tsx => Type::Tsx,
      AssetType::Mdx => Type::Mdx,
      _ if is_jsx => Type::Jsx,
      _ => Type::Js,
    },
    env,
    inline_fs,
    jsx_pragma: jsx_pragma.map(|s| s.to_string()),
    jsx_pragma_frag: jsx_pragma_frag.map(|s| s.to_string()),
    automatic_jsx_runtime,
    jsx_import_source: jsx_import_source.map(|s| s.to_string()),
    decorators,
    use_define_for_class_fields,
    is_development: options.mode == BuildMode::Development,
    react_refresh,
    targets,
    source_maps: asset.target.source_map.is_some(),
    scope_hoist: asset
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
      && asset.target.source_type != SourceType::Script,
    source_type: match asset.target.source_type {
      SourceType::Script => parcel_js_swc_core::SourceType::Script,
      _ => parcel_js_swc_core::SourceType::Module,
    },
    supports_module_workers: asset
      .target
      .engines
      .supports(EnvironmentFeature::WorkerModule),
    is_library: asset.target.flags.contains(EnvironmentFlags::IS_LIBRARY),
    is_esm_output: asset.target.output_format == OutputFormat::Esmodule,
    trace_bailouts: options.log_level == LogLevel::Verbose,
    is_swc_helpers: asset.loc.url.as_str().contains("@swc/helpers"),
    standalone: asset
      .loc
      .url
      .query()
      .map_or(false, |q| q.contains("standalone=true")), // TODO: use a real parser
    inline_constants,
  }
}

pub struct JsPackager {}

impl Packager for JsPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    const RUNTIME: &str = include_str!("runtime.js");

    let mut res = String::new();
    if let Some(main) = bundle.main_entry_asset {
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[main] {
        if let Some(content) = asset.content.downcast_ref::<JsContent>() {
          if let Some(shebang) = &content.shebang {
            write!(res, "#!{}\n", shebang)?;
          }
        }
      }
    }

    for b in &bundle.referenced_bundles {
      let referenced = &bundle_graph.bundles[*b];
      if referenced.ty != AssetType::Js {
        continue;
      }

      write!(
        res,
        "import '{}';\n",
        referenced.relative_specifier(&bundle).unwrap()
      )?;
    }

    write!(res, "var modules = {{\n")?;

    let mut first: bool = true;
    let mut synthetic_assets = IndexSet::new();

    for asset_index in &bundle.assets {
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[*asset_index] {
        let dependencies = asset_dependencies(
          asset,
          bundle_graph,
          bundle,
          &mut synthetic_assets,
          get_inline_bundle_content,
        );

        if !first {
          res.push(',');
        }
        first = false;

        if bundle
          .target
          .flags
          .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
          && let Some(content) = asset.content.downcast_ref::<JsContent>()
        {
          let mut ast = content.ast.lock().unwrap();
          let used_symbols = asset
            .symbols
            .exports
            .iter()
            .filter_map(|e| {
              if e.requested {
                Some(e.exported.as_str().into())
              } else {
                None
              }
            })
            .chain(asset.symbols.indirect.iter().filter_map(|e| {
              if e.requested {
                Some(e.exported.as_str().into())
              } else {
                None
              }
            }))
            .collect();
          // println!("{:?} {:?} {:?}", asset.loc.url, used_symbols, dependencies);
          tree_shake(&mut ast, used_symbols, dependencies, true);
          let (code, map) = ast.to_code(false, false)?;

          write!(
            res,
            "{}:[function(require,module,exports) {{\n{}\n}}]",
            asset_index,
            String::from_utf8_lossy(&code),
          )?;
        } else {
          let code = asset.content.read()?;
          let deps = serde_json::to_string(&dependencies).unwrap();
          write!(
            res,
            "{}:[function(require,module,exports) {{\n{}\n}}, {}]",
            asset_index,
            String::from_utf8_lossy(&code),
            deps
          )?;
        }
      }
    }

    for synthetic_asset in synthetic_assets {
      if !first {
        res.push(',');
      }
      first = false;

      synthetic_asset.write_id(&mut res)?;
      write!(res, ":[function(require,module,exports) {{\n")?;
      synthetic_asset.write_content(&mut res, bundle_graph, bundle, get_inline_bundle_content)?;
      write!(res, "\n}},{{}}]")?;
    }

    write!(res, "}};\n\n")?;
    write!(
      res,
      r#"var parcelRequireName = 'parcelRequire';
var externals = {{}};
var entries = ["#,
    )?;
    for entry in &bundle.entry_assets {
      write!(res, "{}", *entry)?;
    }

    write!(res, "];\nvar mainEntry = ")?;
    if let Some(main) = &bundle.main_entry_asset {
      write!(res, "{};\n", *main)?;
    } else {
      write!(res, "null;\n")?;
    }

    res.push_str(RUNTIME);

    Ok(Arc::new(BufferContent::new(res.into_bytes())))
  }
}

#[derive(PartialEq, Eq, Hash)]
pub enum SyntheticAsset {
  Asset(u32),
  Async(u32),
  Url(u32),
  Inline(u32),
}

pub fn asset_dependencies<'a>(
  asset: &'a Asset,
  bundle_graph: &'a BundleGraph,
  bundle: &'a Bundle,
  additional_assets: &mut IndexSet<SyntheticAsset>,
  get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
) -> IndexMap<String, Resolution<'a>> {
  let mut dependencies = IndexMap::new();

  let used_deps: Vec<u32> = asset.resolved_dependencies().collect();

  for (dep_index, dep) in asset.dependencies.iter().enumerate() {
    let placeholder = dep.placeholder.as_ref().unwrap_or(&dep.specifier);
    match &dep.resolution {
      DependencyResolution::Asset(resolved) => {
        if let AssetNode::Asset(resolved_asset) =
          &bundle_graph.asset_graph.assets[*resolved as usize]
        {
          if resolved_asset.ty != AssetType::Js {
            if resolved_asset.symbols.exports.iter().any(|e| e.requested) {
              dependencies.insert(placeholder.as_str().into(), Resolution::Asset(*resolved));
              additional_assets.insert(SyntheticAsset::Asset(*resolved));
              continue;
            }
            dependencies.insert(placeholder.as_str().into(), Resolution::Excluded);
            continue;
          }

          if dep.target.environment == Environment::ReactServer
            && resolved_asset.target.environment == Environment::ReactClient
          {
            continue;
          }
        }

        let mut resolutions = Vec::new();
        let mut first_asset = None;
        let mut all_assets_match = true;
        if !bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
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
                    *asset_index,
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
                  resolutions.push((import.symbol.as_str(), *asset_index, name.as_str()));
                  if first_asset.is_none() {
                    first_asset = Some(*asset_index);
                  }
                  if first_asset != Some(*asset_index) {
                    all_assets_match = false;
                  }
                }
                SymbolResolution::Namespace { asset_index } => {
                  resolutions.push((import.symbol.as_str(), *asset_index, "*"));
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
            dependencies.insert(placeholder.as_str().into(), Resolution::Asset(res));
          } else {
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::Symbols(resolutions),
            );
          }
        } else if matches!(
          bundle_graph.asset_graph.assets[*resolved as usize],
          AssetNode::Deferred { .. }
        ) || !used_deps.contains(resolved)
        {
          dependencies.insert(placeholder.as_str().into(), Resolution::Excluded);
        } else {
          dependencies.insert(placeholder.as_str().into(), Resolution::Asset(*resolved));
        }
      }
      DependencyResolution::None | DependencyResolution::Excluded => {}
      DependencyResolution::Deferred(_) => {
        dependencies.insert(placeholder.as_str().into(), Resolution::Excluded);
      }
      DependencyResolution::External => {
        dependencies.insert(
          placeholder.as_str().into(),
          Resolution::External(Cow::Borrowed(&dep.specifier)),
        );
      }
      DependencyResolution::Bundle(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[*bundle_index as usize];

        if bundle.target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
          if dep.bundle_behavior == BundleBehavior::Inline
            || resolved_bundle.bundle_behavior == BundleBehavior::Inline
          {
            let content = get_inline_bundle_content(*bundle_index as usize)
              .unwrap()
              .read()
              .unwrap();
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::String(String::from_utf8(content).unwrap()),
            );
          } else if dep.specifier_type == SpecifierType::Url {
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::String(resolved_bundle.relative_url(bundle).unwrap().into()),
            );
          } else {
            dependencies.insert(
              placeholder.as_str().into(),
              Resolution::External(resolved_bundle.relative_specifier(bundle).unwrap().into()),
            );
          }
        } else {
          if dep.bundle_behavior == BundleBehavior::Inline
            || resolved_bundle.bundle_behavior == BundleBehavior::Inline
          {
            additional_assets.insert(SyntheticAsset::Inline(*bundle_index));
          } else if dep.priority == Priority::Lazy && dep.specifier_type != SpecifierType::Url {
            additional_assets.insert(SyntheticAsset::Async(*bundle_index));
          } else {
            additional_assets.insert(SyntheticAsset::Url(*bundle_index));
          };

          dependencies.insert(
            placeholder.as_str().into(),
            Resolution::Bundle(*bundle_index),
          );
        }
      }
    }
  }

  dependencies
}

impl SyntheticAsset {
  pub fn id(&self) -> String {
    match self {
      SyntheticAsset::Asset(id) => format!("{}", id),
      SyntheticAsset::Async(id) => format!("'b{}'", id),
      SyntheticAsset::Url(id) => format!("'b{}'", id),
      SyntheticAsset::Inline(id) => format!("'b{}'", id),
    }
  }

  pub fn write_id<W: std::fmt::Write>(&self, dest: &mut W) -> std::fmt::Result {
    match self {
      SyntheticAsset::Asset(id) => write!(dest, "{}", id),
      SyntheticAsset::Async(id) => write!(dest, "'b{}'", id),
      SyntheticAsset::Url(id) => write!(dest, "'b{}'", id),
      SyntheticAsset::Inline(id) => write!(dest, "'b{}'", id),
    }
  }

  pub fn write_content<W: std::fmt::Write>(
    &self,
    dest: &mut W,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<(), DiagnosticList> {
    match *self {
      SyntheticAsset::Asset(asset_index) => {
        if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[asset_index as usize] {
          for exp in &asset.symbols.exports {
            if !exp.requested {
              continue;
            }

            if let Some(value) = resolve_css_module_export(
              &bundle_graph.asset_graph.assets,
              asset_index as usize,
              exp.exported.as_str(),
            ) {
              write!(dest, "exports.{} = '{}';\n", exp.exported.as_str(), value)?;
            }
          }
        }
      }
      SyntheticAsset::Async(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[bundle_index as usize];
        // if matches!(
        //   bundle.env.context,
        //   EnvironmentContext::ReactServer | EnvironmentContext::ReactClient
        // ) {
        //   load_bundles_rsc(bundle_graph, resolved_bundle, dest)?;
        // } else {
        load_bundles(bundle_graph, bundle, resolved_bundle, dest)?;
        // }
      }
      SyntheticAsset::Inline(bundle_index) => {
        let content = get_inline_bundle_content(bundle_index as usize)?.read()?;
        write!(
          dest,
          "module.exports={:?};",
          String::from_utf8_lossy(&content)
        )?;
      }
      SyntheticAsset::Url(bundle_index) => {
        let resolved_bundle = &bundle_graph.bundles[bundle_index as usize];
        write!(
          dest,
          "module.exports=new URL({:?}, import.meta.url).toString();",
          resolved_bundle.relative_url(&bundle).unwrap()
        )?;
      }
    }

    Ok(())
  }
}

fn load_bundles<W: std::fmt::Write>(
  bundle_graph: &BundleGraph,
  from: &Bundle,
  bundle: &Bundle,
  res: &mut W,
) -> core::fmt::Result {
  if !bundle.referenced_bundles.is_empty() {
    write!(res, "module.exports=Promise.all([")?;
    // TODO: recursive
    for referenced_index in &bundle.referenced_bundles {
      load_bundle(&bundle_graph.bundles[*referenced_index], from, res)?;
      write!(res, ", ")?;
    }

    load_bundle(bundle, from, res)?;
    write!(
      res,
      "]).then(() => require({}));",
      bundle.main_entry_asset.unwrap()
    )?;
  } else {
    write!(res, "module.exports=")?;
    load_bundle(bundle, from, res)?;
    write!(
      res,
      ".then(() => require({}));",
      bundle.main_entry_asset.unwrap()
    )?;
  }

  Ok(())
}

fn load_bundle<W: std::fmt::Write>(
  bundle: &Bundle,
  from: &Bundle,
  res: &mut W,
) -> core::fmt::Result {
  let name = bundle.relative_url(from).unwrap();
  match &bundle.ty {
    AssetType::Js => {
      write!(res, "parcelLoadJS('./{}')", name)
    }
    AssetType::Css => {
      write!(res, "parcelLoadCSS('./{}')", name)
    }
    _ => Ok(()),
  }
}

fn load_bundles_rsc<W: std::fmt::Write>(
  bundle_graph: &BundleGraph,
  from: &Bundle,
  bundle: &Bundle,
  res: &mut W,
) -> core::fmt::Result {
  let mut resources = Vec::new();
  let mut promises = Vec::new();
  for referenced_index in &bundle.referenced_bundles {
    let referenced_bundle = &bundle_graph.bundles[*referenced_index];
    load_bundle_rsc(referenced_bundle, from, res, &mut resources, &mut promises)?;
  }

  load_bundle_rsc(bundle, from, res, &mut resources, &mut promises)?;

  write!(res, "module.exports=Promise.all([")?;
  for p in promises {
    write!(res, "{},", p)?;
  }

  write!(res, "])")?;
  if !resources.is_empty() {
    write!(
      res,
      ".then(()=>createResourcesProxy(require({}), resources))",
      bundle.main_entry_asset.unwrap()
    )?;
  }

  write!(res, ";\n")?;
  Ok(())
}

fn load_bundle_rsc<W: std::fmt::Write>(
  bundle: &Bundle,
  from: &Bundle,
  res: &mut W,
  resources: &mut Vec<String>,
  promises: &mut Vec<String>,
) -> core::fmt::Result {
  let name = bundle.relative_url(&from).unwrap();
  match &bundle.ty {
    AssetType::Js => {
      if bundle.target.environment.is_browser() {
        if bundle.target.environment.is_browser() {
          if bundle.target.output_format == OutputFormat::Esmodule {
            // TODO: how to import jsx runtime?
            resources.push(format!("<link rel='modulepreload' href='{}' />", name));
          } else {
            resources.push(format!(
              "<link rel='preload' as='script' href='{}' />",
              name
            ));
          }
        }
      }

      if bundle.target.environment == bundle.target.environment {
        promises.push(format!("parcelLoadJS('./{}')", name));
      }
    }
    AssetType::Css => {
      resources.push(format!(
        "<link rel='stylesheet' href='{}' precedence='default' />",
        name
      ));
      if bundle.target.environment.is_browser() {
        // TODO: only if not react lazy
        promises.push(format!("waitForCSS('{}')", name));
        write!(
          res,
          "preinit('{}', {{as: 'style', precedence: 'default'}});\n",
          name
        )?;
      }
    }
    _ => {}
  }

  Ok(())
}

pub struct LibraryPackager {}

impl Packager for LibraryPackager {
  fn package(
    &self,
    bundle_graph: &BundleGraph,
    bundle: &Bundle,
    get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, DiagnosticList>,
  ) -> Result<Arc<dyn Content>, DiagnosticList> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = bundle_graph.asset_graph.assets[bundle.main_entry_asset.unwrap()].expect_asset();
    let mut synthetic_assets = IndexSet::new();
    let dependencies = asset_dependencies(
      asset,
      bundle_graph,
      bundle,
      &mut synthetic_assets,
      get_inline_bundle_content,
    );

    let mut res = String::new();
    let code = if let Some(content) = asset.content.downcast_ref::<JsContent>() {
      if let Some(shebang) = &content.shebang {
        write!(res, "#!{}\n", shebang)?;
      }

      let mut ast = content.ast.lock().unwrap();
      let used_symbols = asset
        .symbols
        .exports
        .iter()
        .filter_map(|e| {
          if e.requested {
            Some(e.exported.as_str().into())
          } else {
            None
          }
        })
        .chain(asset.symbols.indirect.iter().filter_map(|e| {
          if e.requested {
            Some(e.exported.as_str().into())
          } else {
            None
          }
        }))
        .collect();
      // println!("{:?} {:?} {:?}", asset.loc.url, used_symbols, dependencies);
      tree_shake(&mut ast, used_symbols, dependencies, false);
      let (code, map) = ast.to_code(false, false)?;
      code
    } else {
      asset.content.read()?
    };

    res.push_str(&std::str::from_utf8(&code).unwrap());

    Ok(Arc::new(BufferContent::new(res.into_bytes())))
  }
}
