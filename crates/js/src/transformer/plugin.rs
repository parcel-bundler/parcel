use std::{cell::RefCell, collections::HashMap, sync::Arc};

use crate::transformer::{Config, ESM_HELPERS, Type, transform_to_ast};
use glob_match::glob_match;
use parcel_core::*;
use parcel_macros::MacroError;
use parcel_plugin_js::call_macro;
use parcel_resolver::{AliasValue, BrowserField, Specifier};
use swc_core::ecma::atoms::Atom;

use crate::JsContent;

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTransformer {
  #[serde(rename = "inlineFS")]
  inline_fs: Option<bool>,
  inline_environment: Option<InlineEnvironment>,
}

#[derive(Clone, serde::Deserialize)]
#[serde(untagged)]
enum InlineEnvironment {
  Bool(bool),
  Array(Vec<String>),
}

impl Default for InlineEnvironment {
  fn default() -> Self {
    InlineEnvironment::Bool(true)
  }
}

impl Transformer for JsTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    options: &ParcelOptions,
    fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    let input_source_map = if asset.target.source_map.is_some() {
      input_source_map(
        &*asset.content,
        &asset.loc.url.to_file_path()?.to_path_buf(),
        &options.project_root.to_path_buf(),
      )
    } else {
      None
    };
    let config = config(&mut asset, options, fs, self)?;
    let source_size = config.code.len();
    let mut resolver = parcel_resolver::Resolver::parcel(options.project_root);
    resolver.conditions |= ExportsCondition::NODE | ExportsCondition::SOURCE;

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
      &**fs,
      if asset.flags.contains(AssetFlags::IS_SOURCE) {
        Some(&call_macro)
      } else {
        None
      },
    )?;

    let is_source = asset.flags.contains(AssetFlags::IS_SOURCE);
    let locate = |mut diagnostic: Diagnostic| {
      for frame in &mut diagnostic.code_frames {
        frame.url = Some(asset.loc.url.clone());
        frame.language = Some(asset.ty.clone());
      }
      diagnostic
    };
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    for diagnostic in res.diagnostics {
      let mut diagnostic = locate(diagnostic);
      match diagnostic.severity {
        DiagnosticSeverity::Error => errors.push(diagnostic),
        DiagnosticSeverity::SourceError if is_source => {
          diagnostic.severity = DiagnosticSeverity::Error;
          errors.push(diagnostic);
        }
        // A source error in a dependency is reported, but does not fail the build.
        DiagnosticSeverity::SourceError => {
          diagnostic.severity = DiagnosticSeverity::Warning;
          warnings.push(diagnostic);
        }
        DiagnosticSeverity::Warning | DiagnosticSeverity::Info => warnings.push(diagnostic),
      }
    }
    if !warnings.is_empty() {
      options.log_diagnostics(LogLevel::Warn, &warnings);
    }
    if !res.bailouts.is_empty() {
      let bailouts: Vec<_> = res.bailouts.into_iter().map(locate).collect();
      options.log_diagnostics(LogLevel::Verbose, &bailouts);
    }
    if !errors.is_empty() {
      return Err(DiagnosticList(errors));
    }

    let directives = res
      .directives
      .iter()
      .map(|directive| directive.to_string())
      .collect::<Vec<_>>();
    let is_rsc_runtime = directives
      .iter()
      .any(|directive| directive == "use parcel-rsc-runtime");

    if let Some(target) = res.target {
      asset.target = target;
    } else if directives.iter().any(|d| d == "use server-entry") {
      if !matches!(
        asset.target.environment,
        Environment::Node | Environment::ReactServer
      ) {
        return Err(DiagnosticList(vec![Diagnostic {
          origin: Some("@parcel/transformer-js".into()),
          message: "use server-entry must be imported in a server environment".into(),
          code_frames: vec![],
          hints: vec![],
          severity: parcel_core::DiagnosticSeverity::Error,
          documentation_url: None,
        }]));
      }
      asset.bundle_behavior = BundleBehavior::Isolated;
    }

    asset.ty = AssetType::Js;

    // Avoid unnecessary shared bundles between actual client code and server code that explicitly
    // runs in the client environment (e.g. React during SSR).
    if asset.target.environment != Environment::ReactClient
      && res
        .dependencies
        .iter()
        .any(|dep| dep.target.environment == Environment::ReactClient)
    {
      asset.flags.remove(AssetFlags::IS_BUNDLE_SPLITTABLE);
    }

    let mut dep_map = HashMap::new();
    for dep in res.dependencies {
      let key = dep.placeholder.as_deref().unwrap_or(&dep.specifier);
      dep_map.insert(Atom::from(key), asset.dependencies.len() as u32);
      asset.dependencies.push(dep);
    }

    if res.needs_esm_helpers {
      let index = asset.dependencies.len() as u32;
      asset.dependencies.push(Dependency {
        specifier: ESM_HELPERS.into(),
        specifier_type: SpecifierType::Esm,
        priority: Priority::Sync,
        bundle_behavior: BundleBehavior::None,
        import_type: ImportType::JavaScript,
        flags: DependencyFlags::FORCE_BUNDLE,
        target: asset.target.clone(),
        loc: None,
        placeholder: None,
        resolve_from: Some(SourceUrl::from_directory_path(&options.project_root)), // TODO
        range: None,
        conditions: ExportsCondition::empty(),
        resolution: DependencyResolution::None,
        concurrent_group: 0,
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

      // Unknown require or dynamic import usage must retain
      // the full namespace because any export could be observed at runtime.
      for source in symbols.non_static_requires {
        let dep_index = dep_map[&source];
        if !asset
          .symbols
          .imports
          .iter()
          .any(|symbol| symbol.dep_index == dep_index && symbol.symbol == SymbolName::Namespace)
        {
          asset.symbols.imports.push(ImportedSymbol {
            dep_index,
            symbol: SymbolName::Namespace,
            resolved: SymbolResolution::None,
          });
        }
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
      .symbols
      .imports
      .sort_by(|a, b| a.dep_index.cmp(&b.dep_index));

    let rsc_runtime_dep = if !is_rsc_runtime {
      let specifier = match asset.target.environment {
        Environment::ReactServer => Some("@parcel/rsc/runtime/server"),
        Environment::ReactClient => Some("@parcel/rsc/runtime/client"),
        _ => None,
      };

      specifier.map(|specifier| {
        let dep_index = asset.dependencies.len() as u32;
        asset.dependencies.push(Dependency {
          specifier: specifier.into(),
          specifier_type: SpecifierType::Esm,
          priority: Priority::Sync,
          bundle_behavior: BundleBehavior::None,
          import_type: ImportType::JavaScript,
          flags: DependencyFlags::FORCE_BUNDLE,
          target: asset.target.clone(),
          loc: None,
          placeholder: Some("__parcel_rsc_runtime__".into()),
          resolve_from: Some(SourceUrl::from_directory_path(&options.project_root)),
          range: None,
          conditions: ExportsCondition::IMPORT,
          resolution: DependencyResolution::None,
          concurrent_group: 0,
        });
        asset.symbols.imports.push(ImportedSymbol {
          dep_index,
          symbol: SymbolName::Namespace,
          resolved: SymbolResolution::None,
        });
        asset
          .symbols
          .imports
          .sort_by(|a, b| a.dep_index.cmp(&b.dep_index));
        dep_index
      })
    } else {
      None
    };

    asset
      .dependencies
      .extend(std::mem::take(&mut *macro_deps.borrow_mut()));
    asset
      .flags
      .set(AssetFlags::HAS_NODE_REPLACEMENTS, res.has_node_replacements);
    if res.has_top_level_await {
      // Libraries keep each module as is, so a CommonJS library has no way to wait for one.
      if asset.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
        && asset.target.output_format != OutputFormat::Esmodule
      {
        return Err(DiagnosticList(vec![Diagnostic {
          origin: Some("@parcel/transformer-js".into()),
          message: "Top-level await is only supported in libraries with ES module output.".into(),
          code_frames: vec![CodeFrame {
            url: Some(asset.loc.url.clone()),
            code: None,
            language: Some(asset.ty.clone()),
            code_highlights: vec![],
          }],
          hints: vec![],
          severity: parcel_core::DiagnosticSeverity::Error,
          documentation_url: None,
        }]));
      }
    }
    asset
      .flags
      .set(AssetFlags::HAS_TOP_LEVEL_AWAIT, res.has_top_level_await);
    asset.content = Arc::new(JsContent {
      source_size,
      ast: res.ast,
      shebang: res.shebang,
      directives,
      rsc_runtime_dep,
      needs_filename: res.needs_filename,
      needs_dirname: res.needs_dirname,
      esm_prologue_len: res.esm_prologue_len,
      react_refresh_wrapped: res.react_refresh_wrapped,
      input_source_map,
    });
    Ok(asset)
  }
}

fn config(
  asset: &mut Asset,
  options: &ParcelOptions,
  fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  transformer: &JsTransformer,
) -> Result<Config, Diagnostic> {
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

        // React Refresh updates components in place over HMR. The transformer further limits it
        // to browser code (see `Config::react_refresh`).
        react_refresh = options.mode == BuildMode::Development
          && options.hmr.is_some()
          && pkg.has_dependency("react");
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

    if asset.flags.contains(AssetFlags::AUTOMATIC_JSX_RUNTIME) {
      automatic_jsx_runtime = true;
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
            automatic_jsx_runtime = automatic_jsx_runtime
              || (tsconfig_jsx_factory.is_none()
                && matches!(automatic_range, Some(automatic_range) if min_version.satisfies(&automatic_range)));
          }
        }

        if automatic_jsx_runtime {
          jsx_import_source = Some(react_lib.into());
        }
      }
    }

    is_jsx = tsconfig_jsx.is_some() || jsx_pragma.is_some();
  }

  if asset.ty == AssetType::Ts {
    is_jsx = false;
  } else if !is_jsx {
    is_jsx = matches!(asset.ty, AssetType::Jsx | AssetType::Tsx);
  }

  if asset.flags.contains(AssetFlags::AUTOMATIC_JSX_RUNTIME) {
    automatic_jsx_runtime = true;
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

  let inline_env = transformer.inline_environment.clone().unwrap_or_default();
  if let Some(fs) = transformer.inline_fs {
    inline_fs = fs;
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
    url: asset.loc.url.clone(),
    code: asset.content.read()?,
    project_root: options
      .project_root
      .to_path_buf()
      .to_string_lossy()
      .into_owned(),
    target: asset.target.clone(),
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
    trace_bailouts: options.log_level == LogLevel::Verbose,
    is_swc_helpers: asset.loc.url.to_file_path()?.ancestors().any(|p| {
      p.file_name() == "helpers" && p.parent().map(|p| p.file_name() == "@swc") == Some(true)
    }),
    standalone: asset
      .loc
      .url
      .query()
      .map_or(false, |q| q.contains("standalone=true")), // TODO: use a real parser
  })
}
