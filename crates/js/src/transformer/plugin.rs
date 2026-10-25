use std::{cell::RefCell, collections::HashMap, sync::Arc};

use crate::transformer::{Config, transform_to_ast};
use glob_match::glob_match;
use parcel_core::*;
use parcel_macros::MacroError;
use parcel_plugin_js::call_macro;
use parcel_resolver::{AliasValue, BrowserField, Specifier};
use serde::{Deserialize, Deserializer, de::Error};
use swc_core::ecma::react_compiler::{CompilerTarget, GatingConfig, default_plugin_options};

use crate::JsContent;

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTransformer {
  #[serde(rename = "inlineFS")]
  inline_fs: Option<bool>,
  inline_environment: Option<InlineEnvironment>,
  #[serde(default, deserialize_with = "deserialize_react_compiler")]
  react_compiler: Option<ReactCompiler>,
}

/// The public subset of React Compiler's options, from `"reactCompiler": true` or an object.
/// See https://react.dev/reference/react-compiler/configuration.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReactCompiler {
  compilation_mode: Option<CompilationMode>,
  panic_threshold: Option<PanicThreshold>,
  /// The React version to compile for. Detected from the package's dependencies if not set.
  target: Option<ReactTarget>,
  gating: Option<GatingConfig>,
}

/// Which functions to compile. The compiler's "syntax" mode only compiles Flow component
/// syntax, which SWC does not parse.
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CompilationMode {
  Infer,
  Annotation,
  All,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PanicThreshold {
  None,
  CriticalErrors,
  AllErrors,
}

#[derive(Clone, Copy, Deserialize)]
enum ReactTarget {
  #[serde(rename = "17")]
  React17,
  #[serde(rename = "18")]
  React18,
  #[serde(rename = "19")]
  React19,
}

fn deserialize_react_compiler<'de, D: Deserializer<'de>>(
  deserializer: D,
) -> Result<Option<ReactCompiler>, D::Error> {
  match serde_json::Value::deserialize(deserializer)? {
    serde_json::Value::Bool(false) => Ok(None),
    serde_json::Value::Bool(true) => Ok(Some(ReactCompiler::default())),
    options @ serde_json::Value::Object(_) => ReactCompiler::deserialize(options)
      .map(Some)
      .map_err(|err| D::Error::custom(format!("invalid reactCompiler options: {err}"))),
    _ => Err(D::Error::custom(
      "reactCompiler must be a boolean or an object of React Compiler options",
    )),
  }
}

#[derive(Clone, serde::Deserialize)]
#[serde(untagged)]
enum InlineEnvironment {
  Bool(bool),
  Array(Vec<String>),
}

impl Transformer for JsTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    ctx: &parcel_core::PluginContext,
  ) -> Result<Asset, DiagnosticList> {
    let options = ctx.options;
    let fs = ctx.fs;
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
    // Macros run in Node, so ignore the browser field.
    resolver.entries.remove(parcel_resolver::Fields::BROWSER);

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
        let src = match res.resolution {
          parcel_resolver::Resolution::Path(p) => {
            Some(p.to_path_buf().to_str().unwrap().to_string())
          }
          // Node builtins (e.g. `fs`) run using the JS runtime's implementation.
          parcel_resolver::Resolution::Builtin { scheme, module }
            if scheme.is_empty() || scheme == "node" =>
          {
            Some(format!("builtin:{}", module))
          }
          _ => None,
        };
        if let Some(src) = src {
          let (res, deps) = call_macro(options, url.clone(), env.clone(), src, export, args, loc)?;
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

    // The result refers to its dependencies by index, after any the asset already has.
    let offset = asset.dependencies.len() as u32;
    asset.dependencies.extend(res.dependencies);
    let symbols = res.symbols;
    asset
      .symbols
      .imports
      .extend(symbols.imports.into_iter().map(|mut symbol| {
        symbol.dep_index += offset;
        symbol
      }));
    asset
      .symbols
      .indirect
      .extend(symbols.indirect.into_iter().map(|mut symbol| {
        symbol.dep_index += offset;
        symbol
      }));
    asset
      .symbols
      .star
      .extend(symbols.star.into_iter().map(|mut symbol| {
        symbol.dep_index += offset;
        symbol
      }));
    asset.symbols.exports.extend(symbols.exports);
    asset.flags.insert(res.flags);
    let rsc_runtime_dep = res.rsc_runtime_dep.map(|index| index + offset);

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
  let mut react_compiler = None;
  if asset.flags.contains(AssetFlags::IS_SOURCE) {
    let mut react_lib = None;
    if let Some(react_compiler_config) = &transformer.react_compiler
      && matches!(
        asset.ty,
        AssetType::Js | AssetType::Jsx | AssetType::Ts | AssetType::Tsx
      )
    {
      let mut compiler_options = default_plugin_options();
      compiler_options.is_dev = options.mode == BuildMode::Development;
      compiler_options.filename = Some(
        asset
          .loc
          .url
          .to_file_path()?
          .to_path_buf()
          .to_string_lossy()
          .into_owned(),
      );
      if let Some(mode) = react_compiler_config.compilation_mode {
        compiler_options.compilation_mode = match mode {
          CompilationMode::Infer => "infer",
          CompilationMode::Annotation => "annotation",
          CompilationMode::All => "all",
        }
        .into();
      }
      if let Some(threshold) = react_compiler_config.panic_threshold {
        compiler_options.panic_threshold = match threshold {
          PanicThreshold::None => "none",
          PanicThreshold::CriticalErrors => "critical_errors",
          PanicThreshold::AllErrors => "all_errors",
        }
        .into();
      }
      compiler_options.gating = react_compiler_config.gating.clone();
      // The compiler targets React 19 by default. Earlier versions need the
      // react-compiler-runtime package.
      let target = react_compiler_config.target.or_else(|| {
        let pkg = pkg.as_deref()?.as_ref().ok()?;
        let major = node_semver::Range::parse(pkg.get_dependency_version("react")?)
          .ok()?
          .min_version()?
          .major;
        match major {
          17 => Some(ReactTarget::React17),
          18 => Some(ReactTarget::React18),
          _ => None,
        }
      });
      if let Some(target) = target {
        compiler_options.target = CompilerTarget::Version(
          match target {
            ReactTarget::React17 => "17",
            ReactTarget::React18 => "18",
            ReactTarget::React19 => "19",
          }
          .into(),
        );
      }
      react_compiler = Some(compiler_options);
    }

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
            if let Some(define) = target_uses_define_for_class_fields(target) {
              use_define_for_class_fields = define;
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

  // By default, only source files get the full environment. Files in node_modules only get
  // NODE_ENV, so other variables don't leak into third-party code. An explicit config applies to all files.
  let inline_env = transformer
    .inline_environment
    .clone()
    .unwrap_or(InlineEnvironment::Bool(
      asset.flags.contains(AssetFlags::IS_SOURCE),
    ));
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
    filename: asset.loc.url.to_file_path()?,
    url: asset.loc.url.clone(),
    code: asset.content.read()?,
    project_root: options.project_root,
    target: asset.target.clone(),
    asset_type: if is_jsx && !matches!(asset.ty, AssetType::Ts | AssetType::Tsx | AssetType::Mdx) {
      AssetType::Jsx
    } else {
      asset.ty.clone()
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
    react_compiler,
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

/// Whether a tsconfig `target` implies `useDefineForClassFields`, which defaults to true
/// for ES2022 and later. TypeScript matches the target case-insensitively, e.g. "ESNext".
fn target_uses_define_for_class_fields(target: &str) -> Option<bool> {
  let target = target.trim().to_ascii_lowercase();
  if target == "esnext" {
    return Some(true);
  }

  // e.g. "es5", "es6" or "es2022".
  let version = target.strip_prefix("es")?;
  if !version.bytes().all(|b| b.is_ascii_digit()) {
    return None;
  }
  Some(version.parse::<u32>().ok()? >= 2022)
}

#[cfg(test)]
mod tests {
  use super::target_uses_define_for_class_fields;

  #[test]
  fn tsconfig_target_define_for_class_fields() {
    assert_eq!(target_uses_define_for_class_fields("esnext"), Some(true));
    assert_eq!(target_uses_define_for_class_fields("ESNext"), Some(true));
    assert_eq!(target_uses_define_for_class_fields("es2022"), Some(true));
    assert_eq!(target_uses_define_for_class_fields("ES2022"), Some(true));
    assert_eq!(target_uses_define_for_class_fields("es2021"), Some(false));
    assert_eq!(target_uses_define_for_class_fields("ES5"), Some(false));
    assert_eq!(target_uses_define_for_class_fields("es6"), Some(false));
    assert_eq!(target_uses_define_for_class_fields("es"), None);
    assert_eq!(target_uses_define_for_class_fields("e"), None);
    assert_eq!(target_uses_define_for_class_fields(""), None);
    assert_eq!(target_uses_define_for_class_fields("é"), None);
    assert_eq!(target_uses_define_for_class_fields("ésnext"), None);
    assert_eq!(target_uses_define_for_class_fields("es+2022"), None);
    assert_eq!(target_uses_define_for_class_fields("latest"), None);
  }
}
