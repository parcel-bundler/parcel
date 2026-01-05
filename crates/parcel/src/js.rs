use std::{
  collections::{HashMap, HashSet},
  fmt::Write,
  path::Path,
  sync::Arc,
};

use indexmap::IndexSet;
use lightningcss::css_modules::CssModuleReference;
use parcel_core::{
  Asset, AssetFlags, AssetNode, AssetType, BufferContent, BuildMode, Bundle, BundleBehavior,
  BundleGraph, Content, Dependency, DependencyFlags, DependencyResolution, Diagnostic,
  DiagnosticList, Environment, EnvironmentContext, EnvironmentFeature, EnvironmentFlags,
  FileSystem, ImportedSymbol, IncludeNodeModules, IndirectSymbol, LocalSymbol, Location, LogLevel,
  OutputFormat, Packager, ParcelOptions, Priority, SourceLocation, SourceType, SourceUrl,
  SpecifierType, StarSymbol, SymbolName, SymbolResolution, Transformer,
};
use parcel_js_swc_core::{
  Ast, Config, DependencyKind, EnvContext, Type, Version, Versions, transform, transform_to_ast,
  tree_shake::tree_shake,
};
use parcel_resolver::{AliasValue, BrowserField, Invalidations, Specifier};

use crate::css::{CssContent, resolve_css_module_export};

struct JsContent {
  ast: Ast,
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
    let (code, _) = self.ast.to_code(false, false)?;
    Ok(code)
  }
}

pub struct JsTransformer {}

impl Transformer for JsTransformer {
  fn transform(&self, mut asset: Asset, options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    let config = config(&mut asset, options);
    let res = transform_to_ast(config, None)?;

    asset.content = Arc::new(JsContent {
      ast: res.ast,
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
        (dep.specifier.clone(), dep.kind.clone()),
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
          // if dep.flags.contains(parcel_js_swc_core::Depe)
          if dep.kind == DependencyKind::WebWorker {
            flags |= DependencyFlags::IS_WEBWORKER;
          }
          flags
        },
        env: match dep.kind {
          DependencyKind::WebWorker => {
            // Use native ES module output if the worker was created with `type: 'module'` and all targets
            // support native module workers. Only do this if parent asset output format is also esmodule so that
            // assets can be shared between workers and the main thread in the global output format.
            let mut output_format = asset.env.output_format;
            if output_format == OutputFormat::Esmodule
              && dep.source_type == Some(parcel_js_swc_core::SourceType::Module)
              && asset.env.engines.supports(EnvironmentFeature::WorkerModule)
            {
              output_format = OutputFormat::Esmodule;
            } else if output_format != OutputFormat::Commonjs {
              output_format = OutputFormat::Global;
            }

            Arc::new(Environment {
              context: EnvironmentContext::WebWorker,
              source_type: match dep.source_type {
                Some(parcel_js_swc_core::SourceType::Module) => SourceType::Module,
                _ => SourceType::Script,
              },
              output_format,
              loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
              ..(*asset.env).clone()
            })
          }
          DependencyKind::ServiceWorker => Arc::new(Environment {
            context: EnvironmentContext::ServiceWorker,
            source_type: match dep.source_type {
              Some(parcel_js_swc_core::SourceType::Module) => SourceType::Module,
              _ => SourceType::Script,
            },
            output_format: OutputFormat::Global,
            loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
            ..(*asset.env).clone()
          }),
          DependencyKind::Worklet => Arc::new(Environment {
            context: EnvironmentContext::Worklet,
            source_type: SourceType::Module,
            output_format: OutputFormat::Esmodule,
            loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
            ..(*asset.env).clone()
          }),
          DependencyKind::DynamicImport => {
            // If all of the target engines support dynamic import natively,
            // we can output native ESM if scope hoisting is enabled.
            // Only do this for scripts, rather than modules in the global
            // output format so that assets can be shared between the bundles.
            let mut output_format = asset.env.output_format;
            if asset.env.source_type == SourceType::Script
              && asset
                .env
                .flags
                .contains(EnvironmentFlags::SHOULD_SCOPE_HOIST)
              && asset
                .env
                .engines
                .supports(EnvironmentFeature::DynamicImport)
            {
              output_format = OutputFormat::Esmodule;
            }

            if asset.env.source_type != SourceType::Module
              || asset.env.output_format != output_format
            {
              Arc::new(Environment {
                source_type: SourceType::Module,
                output_format,
                loc: Some(convert_loc(asset.loc.url.clone(), &dep.loc)),
                ..(*asset.env).clone()
              })
            } else {
              asset.env.clone()
            }
          }
          DependencyKind::Url | DependencyKind::File | DependencyKind::Id => asset.env.clone(),
          DependencyKind::Import | DependencyKind::Export | DependencyKind::Require => {
            // Always bundle helpers, even with includeNodeModules: false, except if this is a library.
            if is_helper && !asset.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
              Arc::new(Environment {
                include_node_modules: IncludeNodeModules::Bool(true),
                ..(*asset.env).clone()
              })
            } else {
              asset.env.clone()
            }
          }
        },
        loc: None,
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
        env: Arc::new(Environment {
          include_node_modules: IncludeNodeModules::Array(vec!["@parcel/transformer-js".into()]),
          ..(*asset.env).clone()
        }),
        loc: None,
        placeholder: None,
        resolve_from: Some(options.project_root.clone()), // TODO
        range: None,
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
        let dep_index = dep_map[&(import.source, import.kind.into())];
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
          let dep_index = dep_map[&(source, DependencyKind::Export)];
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
        let dep_index = dep_map[&(star.source, DependencyKind::Export)];
        asset.symbols.star.push(StarSymbol {
          dep_index,
          requested: false,
        });
      }
    }

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

    if let Some(tsconfig) = resolver.find_tsconfig(
      &resolver
        .cache()
        .get(options.project_root.to_file_path().unwrap()),
      &invalidations,
    ) {
      if let Ok(tsconfig) = &*tsconfig {
        jsx_pragma = tsconfig
          .compiler_options
          .jsx_factory
          .clone()
          .or_else(|| match react_lib {
            Some("react") => Some("React.createElement".into()),
            Some("preact") => Some("h".into()),
            Some("nervjs") => Some("Nerv.createElement".into()),
            Some("hyperapp") => Some("h".into()),
            _ => None,
          });

        jsx_pragma_frag = tsconfig
          .compiler_options
          .jsx_fragment_factory
          .clone()
          .or_else(|| match react_lib {
            Some("react") => Some("React.Fragment".into()),
            Some("preact") => Some("Fragment".into()),
            _ => None,
          });

        if matches!(
          tsconfig.compiler_options.jsx,
          Some(parcel_resolver::Jsx::ReactJsx | parcel_resolver::Jsx::ReactJsxdev)
        ) || tsconfig.compiler_options.jsx_import_source.is_some()
        {
          jsx_import_source = tsconfig.compiler_options.jsx_import_source.clone();
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
                automatic_jsx_runtime = tsconfig.compiler_options.jsx_factory.is_none()
                  && matches!(automatic_range, Some(automatic_range) if min_version.satisfies(&automatic_range));
              }

              if automatic_jsx_runtime {
                jsx_import_source = Some(react_lib.into());
              }
            }
          }
        }

        is_jsx = tsconfig.compiler_options.jsx.is_some() || jsx_pragma.is_some();
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

      if asset.ty == AssetType::Ts {
        is_jsx = false;
      } else if !is_jsx {
        is_jsx = matches!(asset.ty, AssetType::Jsx | AssetType::Tsx);
      }
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

  let env = HashMap::new();
  let mut inline_constants = false;
  if let Some(root_pkg) = resolver.find_package(
    &resolver
      .cache()
      .get(options.project_root.to_file_path().unwrap()),
    &invalidations,
  ) {
    if let Ok(root_pkg) = &*root_pkg {
      if let Some(config) = &root_pkg.js_transformer_config {
        // if let Some(inline_environment) = &config.inline_environment {
        //   inline_env = inline_environment.clone(); // TODO: we could borrow here
        // }

        if let Some(fs) = config.inline_fs {
          inline_fs = fs;
        }

        inline_constants = config.inline_constants;
      }
    }
  }

  Config {
    filename: asset.loc.url.to_string(),
    code: asset.content.read().unwrap(),
    module_id: asset.id(),
    project_root: options.project_root.to_string(),
    context: match &asset.env.context {
      EnvironmentContext::Browser => EnvContext::Browser,
      EnvironmentContext::WebWorker => EnvContext::WebWorker,
      EnvironmentContext::ServiceWorker => EnvContext::ServiceWorker,
      EnvironmentContext::Worklet => EnvContext::Worklet,
      EnvironmentContext::Node => EnvContext::Node,
      EnvironmentContext::ElectronRenderer => EnvContext::ElectronRenderer,
      EnvironmentContext::ElectronMain => EnvContext::ElectronMain,
      EnvironmentContext::ReactClient => EnvContext::ReactClient,
      EnvironmentContext::ReactServer => EnvContext::ReactServer,
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

      let name = referenced.name.as_ref().unwrap();
      write!(
        res,
        "import './{}';\n",
        name.file_name().unwrap().to_str().unwrap()
      )?;
    }

    write!(res, "var modules = {{\n")?;

    let mut first: bool = true;
    let mut resolved_bundles = IndexSet::new();
    let mut non_js_assets = IndexSet::new();
    #[derive(Hash, PartialEq, Eq)]
    enum ResolutionType {
      Async,
      Url,
      Inline,
    }

    for asset_index in &bundle.assets {
      if let AssetNode::Asset(asset) = &bundle_graph.asset_graph.assets[*asset_index] {
        let mut deps = String::new();
        deps.push('{');
        let mut first_dep = true;
        for (dep_index, dep) in asset.dependencies.iter().enumerate() {
          if !first_dep {
            deps.push(',');
          }
          first_dep = false;

          let placeholder = dep.placeholder.as_ref().unwrap_or(&dep.specifier);
          match &dep.resolution {
            DependencyResolution::Asset(resolved) => {
              if let AssetNode::Asset(resolved_asset) =
                &bundle_graph.asset_graph.assets[*resolved as usize]
              {
                if resolved_asset.ty != AssetType::Js {
                  if resolved_asset.symbols.exports.iter().any(|e| e.requested) {
                    write!(deps, "'{}': {}", placeholder, *resolved)?;
                    non_js_assets.insert(*resolved);
                    continue;
                  }
                  write!(deps, "'{}': false", placeholder)?;
                  continue;
                }
              }

              let mut resolutions = Vec::new();
              for import in &asset.symbols.imports {
                if import.dep_index == dep_index as u32 {
                  match &import.resolved {
                    SymbolResolution::Export {
                      asset_index,
                      export_index,
                    } => {
                      let asset =
                        bundle_graph.asset_graph.assets[*asset_index as usize].expect_asset();
                      let export = &asset.symbols.exports[*export_index as usize];
                      resolutions.push((
                        import.symbol.as_str(),
                        *asset_index,
                        export.exported.as_str(),
                      ));
                    }
                    SymbolResolution::Runtime { asset_index, name } => {
                      resolutions.push((import.symbol.as_str(), *asset_index, name.as_str()));
                    }
                    SymbolResolution::Namespace { asset_index } => {
                      resolutions.push((import.symbol.as_str(), *asset_index, "*"));
                    }
                    _ => continue,
                  }
                }
              }

              // TODO: add indirect/star exports

              if !resolutions.is_empty() {
                let s = serde_json::to_string(&resolutions).unwrap();
                write!(deps, "'{}': {}", placeholder, s)?;
              } else {
                write!(deps, "'{}': {}", placeholder, *resolved)?;
              }
            }
            DependencyResolution::None
            | DependencyResolution::Excluded
            | DependencyResolution::Deferred(_) => {
              write!(deps, "'{}': {}", placeholder, "false")?;
            }
            DependencyResolution::External => {
              write!(deps, "'{}': '{}'", placeholder, dep.specifier)?;
            }
            DependencyResolution::Bundle(bundle_index) => {
              let bundle = &bundle_graph.bundles[*bundle_index as usize];
              let resolution_type = if dep.bundle_behavior == BundleBehavior::Inline
                || bundle.bundle_behavior == BundleBehavior::Inline
              {
                ResolutionType::Inline
              } else if dep.specifier_type == SpecifierType::Url {
                ResolutionType::Url
              } else {
                ResolutionType::Async
              };

              resolved_bundles.insert((*bundle_index, resolution_type));
              write!(deps, "'{}': 'b{}'", placeholder, bundle_index)?;
            }
          }
        }

        deps.push('}');

        if !first {
          res.push(',');
        }
        first = false;

        let code = if bundle.env.flags.contains(EnvironmentFlags::SHOULD_OPTIMIZE)
          && let Some(content) = asset.content.downcast_ref::<JsContent>()
        {
          let mut ast = content.ast.clone();
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
            .collect();
          tree_shake(&mut ast, used_symbols);
          let (code, map) = ast.to_code(false, true)?;
          code
        } else {
          asset.content.read()?
        };

        write!(
          res,
          "{}:[function(require,module,exports) {{\n{}\n}},{}]",
          asset_index,
          String::from_utf8_lossy(&code),
          deps
        )?;
      }
    }

    for asset_index in non_js_assets {
      if !first {
        res.push(',');
      }
      first = false;

      write!(
        res,
        "{}:[function(require,module,exports) {{\n",
        asset_index,
      )?;

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
            write!(res, "exports.{} = '{}';\n", exp.exported.as_str(), value)?;
          }
        }
      }

      write!(res, "\n}},{{}}]")?;
    }

    for (bundle_index, ty) in resolved_bundles {
      let bundle = &bundle_graph.bundles[bundle_index as usize];
      write!(
        res,
        ",'b{}':[function(require,module){{\nmodule.exports=",
        bundle_index
      )?;

      match ty {
        ResolutionType::Async => {
          // TODO
          if !bundle.referenced_bundles.is_empty() {
            write!(res, "Promise.all([")?;
            for referenced_index in &bundle.referenced_bundles {
              load_bundle(&bundle_graph.bundles[*referenced_index], &mut res)?;
              res.push_str(", ");
            }

            load_bundle(bundle, &mut res)?;
            write!(
              res,
              "]).then(() => require({}))",
              bundle.main_entry_asset.unwrap()
            )?;
          } else {
            load_bundle(bundle, &mut res)?;
            write!(
              res,
              ".then(() => require({}))",
              bundle.main_entry_asset.unwrap()
            )?;
          }
        }
        ResolutionType::Inline => {
          let content = get_inline_bundle_content(bundle_index as usize)?.read()?;
          write!(res, "{:?}", String::from_utf8_lossy(&content))?;
        }
        ResolutionType::Url => {
          write!(res, "{:?}", bundle.name.as_ref().unwrap())?;
        }
      }

      write!(res, ";\n}},{{}}]")?;
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

fn load_bundle(bundle: &Bundle, res: &mut String) -> core::fmt::Result {
  let name = bundle
    .name
    .as_ref()
    .unwrap()
    .file_name()
    .unwrap()
    .to_str()
    .unwrap();
  match &bundle.ty {
    AssetType::Js => {
      write!(res, "parcelLoadJS('./{}')", name)
    }
    AssetType::Css => {
      write!(res, "parcelLoadCSS('./{}')", name)
    }
    _ => todo!(),
  }
}
