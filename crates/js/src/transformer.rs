use std::{
  cell::RefCell,
  collections::HashMap,
  sync::{Arc, Mutex},
};

use glob_match::glob_match;
use parcel_core::*;
use parcel_js_swc_core::{
  Config, DependencyKind, EnvContext, Type, Version, Versions, transform_to_ast,
};
use parcel_macros::MacroError;
use parcel_plugin_js::call_macro;
use parcel_resolver::{AliasValue, BrowserField, InlineEnvironment, Specifier};

use crate::JsContent;

pub struct JsTransformer {}

impl Transformer for JsTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    options: &ParcelOptions,
    fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    let config = config(&mut asset, options, fs)?;
    let resolver = parcel_resolver::Resolver::parcel(options.project_root);

    let url = asset.loc.url.clone();
    let env = asset.target.clone();
    let resolve_from = asset.loc.url.to_file_path()?;
    let macro_deps = Arc::new(RefCell::new(Vec::new()));
    let macro_deps_cloned = macro_deps.clone();
    let fs_cloned = fs.clone();
    let call_macro = move |src: String, export, args, loc| {
      let resolved = resolver.resolve(
        &src,
        resolve_from,
        parcel_resolver::SpecifierType::Esm,
        &*fs_cloned,
      );
      if let Ok(res) = resolved {
        if let parcel_resolver::Resolution::Path(p) = res.resolution {
          let (res, deps) = call_macro(
            options,
            url.clone(),
            env.clone(),
            p.to_path_buf().to_str().unwrap().to_string(),
            export,
            args,
            loc,
            fs,
          )?;
          macro_deps_cloned.borrow_mut().extend(deps);
          return Ok(res);
        }
      }

      return Err(MacroError::LoadError(
        format!("Could not resolve macro '{}'", src),
        Default::default(),
      ));
    };
    let res = transform_to_ast(
      config,
      if asset.flags.contains(AssetFlags::IS_SOURCE) {
        Some(&call_macro)
      } else {
        None
      },
    )?;

    if let Some(diagnostics) = res.diagnostics {
      let diagnostics: Vec<Diagnostic> = diagnostics
        .into_iter()
        .filter(|d| {
          d.severity == parcel_js_swc_core::DiagnosticSeverity::Error
            || (d.severity == parcel_js_swc_core::DiagnosticSeverity::SourceError
              && asset.flags.contains(AssetFlags::IS_SOURCE))
        })
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
                  column: h.loc.start_col as u32,
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

    let is_mdx = asset.ty == AssetType::Mdx;
    asset.ty = AssetType::Js;
    asset.content = Arc::new(JsContent {
      ast: Mutex::new(res.ast),
      shebang: res.shebang,
      directives: res.directives.into_iter().map(|d| d.to_string()).collect(),
    });

    let mut dep_map = HashMap::new();
    for dep in res.dependencies {
      if dep.kind == DependencyKind::File {
        continue;
      }

      let is_helper = dep
        .flags
        .contains(parcel_js_swc_core::DependencyFlags::HELPER)
        && dep.kind != DependencyKind::Url
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
          Some(SourceUrl::from_directory_path(&options.project_root).unwrap())
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
        resolution: if is_mdx
          && dep.specifier.starts_with("mdx-")
          && let Some(mdx_asset) = dep.specifier[4..]
            .parse()
            .ok()
            .and_then(|i| res.mdx_assets.get::<usize>(i))
        {
          DependencyResolution::Deferred(Arc::new(AssetRequest {
            loc: SourceLocation {
              url: asset.loc.url.clone(),
              start: Location {
                line: mdx_asset
                  .position
                  .as_ref()
                  .map(|p| p.start.line as u32)
                  .unwrap_or(0),
                column: mdx_asset
                  .position
                  .as_ref()
                  .map(|p| p.start.column as u32)
                  .unwrap_or(0),
              },
              end: Location {
                line: mdx_asset
                  .position
                  .as_ref()
                  .map(|p| p.end.line as u32)
                  .unwrap_or(0),
                column: mdx_asset
                  .position
                  .as_ref()
                  .map(|p| p.end.column as u32)
                  .unwrap_or(0),
              },
            },
            ty: AssetType::from_extension(&mdx_asset.lang),
            content: Arc::new(BufferContent::new(mdx_asset.code.clone().into_bytes())),
            pipeline: None,
            side_effects: true,
            target: asset.target.clone(),
          }))
        } else {
          DependencyResolution::None
        },
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
        resolve_from: Some(SourceUrl::from_directory_path(&options.project_root).unwrap()), // TODO
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
      asset.flags.set(AssetFlags::IS_ESM, symbols.is_esm);
      asset
        .flags
        .set(AssetFlags::STATIC_EXPORTS, symbols.static_cjs_exports);

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

fn config(
  asset: &mut Asset,
  options: &ParcelOptions,
  fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
) -> Result<Config, Diagnostic> {
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

  let resolver = parcel_resolver::Resolver::parcel(options.project_root);

  let pkg = resolver.find_package(asset.loc.url.to_file_path()?, &**fs);
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
          for lib in &["react", "preact", "nervjs", "hyperapp"] {
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
    if let Some(tsconfig) = resolver.find_tsconfig(asset.loc.url.to_file_path()?, &**fs) {
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
            "react" => Some(node_semver::Range::parse(">= 17.0.0 || ^16.14.0 || 0.0.0").unwrap()),
            "preact" => Some(node_semver::Range::parse(">= 10.5.0").unwrap()),
            _ => None,
          };

          if let Some(mut min_version) = pkg
            .get_dependency_version(effective_react_lib)
            .filter(|v| *v != "*")
            .and_then(|v| node_semver::Range::parse(v).ok())
            .and_then(|r| r.min_version())
          {
            min_version.pre_release.clear();
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
        if browser.get(&Specifier::Builtin("".into(), "fs".into()))
          == Some(&AliasValue::Bool(false))
        {
          inline_fs = false;
        }
      }
    }
  }

  let mut inline_constants = false;
  let mut inline_env = InlineEnvironment::default();
  if let Some(root_pkg) = resolver.find_package(options.project_root, &**fs) {
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

  Ok(Config {
    filename: asset
      .loc
      .url
      .to_file_path()?
      .to_path_buf()
      .to_string_lossy()
      .into_owned(),
    code: asset.content.read()?,
    module_id: asset.id(&options.project_root),
    project_root: options
      .project_root
      .to_path_buf()
      .to_string_lossy()
      .into_owned(),
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
    is_swc_helpers: asset.loc.url.to_file_path()?.ancestors().any(|p| {
      p.file_name() == "helpers" && p.parent().map(|p| p.file_name() == "@swc") == Some(true)
    }),
    standalone: asset
      .loc
      .url
      .query()
      .map_or(false, |q| q.contains("standalone=true")), // TODO: use a real parser
    inline_constants,
  })
}
