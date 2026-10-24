pub mod async_module;
mod collect;
mod dependency_collector;
mod env_replacer;
mod fs;
mod global_replacer;
mod mdx;
mod modules;
mod node_replacer;
mod plugin;
mod react_compiler;
mod react_lazy;
#[cfg(test)]
mod test_utils;
mod typeof_replacer;
pub mod utils;

pub use plugin::JsTransformer;

use std::{
  collections::{HashMap, HashSet},
  path::PathBuf,
  sync::Arc,
};

use collect::{Collect, import_namespace};
pub use dependency_collector::{DependencyKind, dependency_collector};
use env_replacer::*;
use fs::inline_fs;
use global_replacer::GlobalReplacer;
use indexmap::IndexMap;
pub use mdx::mdx;
use modules::esm2cjs;
use node_replacer::NodeReplacer;
use parcel_core::{
  AssetFlags, AssetSymbols, AssetType, Dependency, DependencyResolution, Environment,
  EnvironmentFeature, EnvironmentFlags, FileSystem, IncludeNodeModules, OutputFormat, PathId,
  SourceUrl, SpecifierType, Target,
};
use parcel_macros::{MacroCallback, MacroError, Macros};

use react_compiler::react_compiler;
use react_lazy::ReactLazy;
pub use swc_core::ecma::preset_env::{Version, Versions};
use swc_core::{
  common::{
    DUMMY_SP, FileName, Globals, Mark, SourceMap, SyntaxContext, errors::Handler, pass::Optional,
    source_map::SourceMapGenConfig, sync::Lrc,
  },
  ecma::{
    ast::{BlockStmt, Expr, ExprStmt, Ident, Lit, Module, ModuleItem, Program, Stmt, Str, TryStmt},
    atoms::Atom as JsWord,
    codegen::text_writer::JsWriter,
    parser::{EsSyntax, Parser, StringInput, Syntax, TsSyntax, error::Error, lexer::Lexer},
    preset_env::{Mode::Entry, Targets, transform_from_env},
    transforms::{
      base::{
        assumptions::Assumptions,
        fixer::{fixer, paren_remover},
        helpers,
        hygiene::hygiene,
        resolver,
      },
      compat::reserved_words::reserved_words,
      optimization::simplify::{dead_branch_remover, expr_simplifier},
      proposal::decorators,
      react, typescript,
    },
    visit::{FoldWith, VisitMutWith, VisitWith},
  },
  quote,
};
use swc_node_comments::SwcComments;
use typeof_replacer::*;
pub use utils::{Diagnostic, DiagnosticSeverity, SourceType};
use utils::{
  ErrorBuffer, diagnostic, error_buffer_to_diagnostics, fold_member_expr_skip_prop, highlight, id,
};

type SourceMapBuffer = Vec<(swc_core::common::BytePos, swc_core::common::LineCol)>;

pub(crate) const ESM_HELPERS: &str = "@parcel/parcel3/src/esmodule-helpers.js";
pub(crate) const MDX_COMPONENTS: &str = "@parcel/parcel3/src/mdx-components";

#[derive(Default, Debug)]
pub struct Config {
  pub filename: PathId,
  pub url: SourceUrl,
  pub code: Vec<u8>,
  pub project_root: PathId,
  /// The target the module is compiled for. A "use client" or "use server" directive replaces it
  /// (see `directive_target`).
  pub target: Arc<Target>,
  pub asset_type: AssetType,
  pub env: HashMap<JsWord, JsWord>,
  pub inline_fs: bool,
  pub jsx_pragma: Option<String>,
  pub jsx_pragma_frag: Option<String>,
  pub automatic_jsx_runtime: bool,
  pub jsx_import_source: Option<String>,
  pub decorators: bool,
  pub use_define_for_class_fields: bool,
  pub is_development: bool,
  pub react_refresh: bool,
  /// React Compiler options, if it runs on this module.
  pub react_compiler: Option<swc_core::ecma::react_compiler::PluginOptions>,
  pub trace_bailouts: bool,
  pub is_swc_helpers: bool,
  pub standalone: bool,
}

impl Config {
  fn environment(&self) -> Environment {
    self.target.environment
  }

  fn is_browser(&self) -> bool {
    self.environment().is_browser()
  }

  fn is_node(&self) -> bool {
    self.environment().is_node()
  }

  fn is_worker(&self) -> bool {
    self.environment().is_worker()
  }

  fn is_library(&self) -> bool {
    self.target.flags.contains(EnvironmentFlags::IS_LIBRARY)
  }

  fn is_esm_output(&self) -> bool {
    self.target.output_format == OutputFormat::Esmodule
  }

  fn source_type(&self) -> SourceType {
    self.target.source_type
  }

  fn minify(&self) -> bool {
    self
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
  }

  fn supports_module_workers(&self) -> bool {
    self
      .target
      .engines
      .supports(EnvironmentFeature::WorkerModule)
  }

  /// The engine versions to compile syntax down to, or None to leave syntax as is.
  fn versions(&self) -> Option<Versions> {
    let engines = &self.target.engines;
    let environment = self.environment();
    if environment.is_electron() {
      engines.electron.as_ref().map(|electron| Versions {
        electron: Some(convert_version(electron)),
        ..Default::default()
      })
    } else if environment.is_browser() {
      let browsers = &engines.browsers;
      let versions = Versions {
        android: browsers.android.as_ref().map(convert_version),
        chrome: browsers.chrome.as_ref().map(convert_version),
        edge: browsers.edge.as_ref().map(convert_version),
        firefox: browsers.firefox.as_ref().map(convert_version),
        ie: browsers.ie.as_ref().map(convert_version),
        ios: browsers.ios_saf.as_ref().map(convert_version),
        opera: browsers.opera.as_ref().map(convert_version),
        safari: browsers.safari.as_ref().map(convert_version),
        samsung: browsers.samsung.as_ref().map(convert_version),
        ..Default::default()
      };
      (!versions.is_any_target()).then_some(versions)
    } else if environment.is_node() {
      engines.node.as_ref().map(|node| Versions {
        node: Some(convert_version(node)),
        ..Default::default()
      })
    } else {
      None
    }
  }

  fn react_refresh(&self) -> bool {
    self.is_browser()
      && !self.is_library()
      && !self.is_worker()
      && self.environment() != Environment::Worklet
      && self.react_refresh
  }

  fn inline_fs(&self) -> bool {
    self.inline_fs && !self.is_node() && self.source_type() != SourceType::Script
  }

  fn insert_node_globals(&self) -> bool {
    !self.is_node() && self.source_type() != SourceType::Script && !self.is_library()
  }

  fn replace_env(&self) -> bool {
    !self.is_node() || self.environment() == Environment::ReactServer
  }

  fn is_jsx(&self) -> bool {
    matches!(
      self.asset_type,
      AssetType::Jsx | AssetType::Tsx | AssetType::Mdx
    )
  }

  fn is_type_script(&self) -> bool {
    matches!(self.asset_type, AssetType::Ts | AssetType::Tsx)
  }
}

fn convert_version(version: &parcel_core::Version) -> Version {
  Version {
    major: version.major() as u32,
    minor: version.minor() as u32,
    patch: 0,
  }
}

/// The target a "use client" or "use server" directive moves a module to, if any.
fn directive_target(target: &Arc<Target>, directives: &[JsWord]) -> Option<Arc<Target>> {
  if target.flags.contains(EnvironmentFlags::IS_LIBRARY) {
    return None;
  }

  let has_directive = |directive: &str| directives.iter().any(|d| d == directive);
  match target.environment {
    Environment::ReactServer
      if has_directive("use client") || has_directive("use client-entry") =>
    {
      Some(react_target(target, Environment::ReactClient))
    }
    Environment::ReactClient if has_directive("use server") => {
      Some(react_target(target, Environment::ReactServer))
    }
    _ => None,
  }
}

/// The target for code in a React environment, imported from code with the given target.
pub(crate) fn react_target(target: &Arc<Target>, environment: Environment) -> Arc<Target> {
  if target.environment == environment {
    return target.clone();
  }

  if environment == Environment::ReactServer
    && let Some(server_target) = &target.rsc_server_target
  {
    return server_target.clone();
  }

  let rsc_server_target = if environment == Environment::ReactClient {
    match target.environment {
      Environment::ReactServer => Some(target.clone()),
      _ => target.rsc_server_target.clone(),
    }
  } else {
    None
  };

  Arc::new(Target {
    environment,
    rsc_server_target,
    source_type: SourceType::Module,
    // Server code runs in the same environment as the code that imports it, and client code in
    // browsers.
    output_format: match environment {
      Environment::ReactServer => target.output_format,
      Environment::ReactClient => OutputFormat::Esmodule,
      _ => unreachable!(),
    },
    include_node_modules: IncludeNodeModules::Bool(true),
    ..(**target).clone()
  })
}

#[derive(Clone)]
pub struct Ast {
  pub program: Module,
  pub globals: Arc<Globals>,
  pub source_map: Lrc<SourceMap>,
  pub comments: SwcComments,
  pub global_mark: Mark,
  pub unresolved_mark: Mark,
}

impl Default for Ast {
  fn default() -> Self {
    let globals = Globals::new();
    let (global_mark, unresolved_mark) =
      swc_core::common::GLOBALS.set(&globals, || (Mark::new(), Mark::new()));

    Ast {
      program: Default::default(),
      globals: Arc::new(globals),
      source_map: Default::default(),
      comments: Default::default(),
      global_mark,
      unresolved_mark,
    }
  }
}

#[derive(Default)]
#[non_exhaustive]
pub struct TransformAstResult {
  pub ast: Ast,
  /// The target a "use client" or "use server" directive moved the module to.
  pub target: Option<Arc<Target>>,
  pub shebang: Option<String>,
  pub dependencies: Vec<Dependency>,
  /// The symbols the module imports and exports, referring to `dependencies` by index.
  pub symbols: AssetSymbols,
  /// How the module exports its symbols, if they could be statically analyzed.
  pub flags: AssetFlags,
  /// The index of the dependency on the React Server Components runtime, if any.
  pub rsc_runtime_dep: Option<u32>,
  pub diagnostics: Vec<Diagnostic>,
  /// Why symbols could not be statically analyzed, when `Config::trace_bailouts` is set.
  pub bailouts: Vec<Diagnostic>,
  pub has_node_replacements: bool,
  pub needs_filename: bool,
  pub needs_dirname: bool,
  /// Whether the module contains top-level await, i.e. evaluates asynchronously.
  pub has_top_level_await: bool,
  /// The number of statements the module starts with that define its exports and require its
  /// imports (see `async_module`).
  pub esm_prologue_len: usize,
  /// Whether the module's body is wrapped for React Refresh, in the `try` block of its last statement.
  pub react_refresh_wrapped: bool,
  pub directives: Vec<JsWord>,
}

impl Ast {
  pub fn finalize(&mut self) {
    swc_core::common::GLOBALS.set(&*self.globals, || {
      self
        .program
        .visit_mut_with(&mut (reserved_words(), hygiene(), fixer(Some(&self.comments))));
    });
  }

  /// Generates code, and a source map if `source_maps` is set, whose `sources` are relative to
  /// `source_root` if given.
  pub fn to_code(
    &self,
    source_maps: bool,
    source_root: Option<&str>,
    minify: bool,
  ) -> Result<(Vec<u8>, Option<String>), std::io::Error> {
    swc_core::common::GLOBALS.set(&*self.globals, || {
      let mut map_buf = Vec::new();
      let (buf, src_map_buf) = emit(
        self.source_map.clone(),
        &self.comments,
        &self.program,
        source_maps,
        minify,
      )?;
      let map = if source_maps && {
        let mut map = self
          .source_map
          .build_source_map(&src_map_buf, None, SourceMapConfig);
        map.set_source_root(source_root.map(str::to_owned));
        map.to_writer(&mut map_buf).is_ok()
      } {
        Some(String::from_utf8(map_buf).unwrap())
      } else {
        None
      };
      Ok((buf, map))
    })
  }
}

/// Transforms a module. Files it reads, e.g. for `fs.readFileSync` calls it inlines, are read
/// through `fs`.
pub fn transform_to_ast(
  mut config: Config,
  fs: &dyn FileSystem,
  call_macro: Option<MacroCallback>,
) -> Result<TransformAstResult, std::io::Error> {
  let mut result = TransformAstResult::default();

  let code = unsafe { std::str::from_utf8_unchecked(&config.code) };
  let source_map = result.ast.source_map.clone();
  // Attempt to convert the path to be relative to the project root.
  // If outside the project root, use an absolute path so that if the project root moves the path still works.
  let filename: PathBuf = if config.filename.is_inside(config.project_root) {
    config.filename.relative(&config.project_root)
  } else {
    config.filename.to_path_buf()
  };

  let mut mdx_assets = Vec::new();
  let (module, comments) = if matches!(config.asset_type, AssetType::Mdx) {
    source_map.new_source_file(Lrc::new(FileName::Real(filename)), code.to_owned());

    let res = mdx(&config);
    match res {
      Err(diagnostic) => {
        result.diagnostics = vec![diagnostic];
        return Ok(result);
      }
      Ok(res) => {
        mdx_assets = res.assets;
        (Program::Module(res.module), res.comments)
      }
    }
  } else {
    let module = parse(code, filename, &source_map, &config);

    match module {
      Err(errs) => {
        let error_buffer = ErrorBuffer::default();
        let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
        for err in errs {
          err.into_diagnostic(&handler).emit();
        }

        result.diagnostics = error_buffer_to_diagnostics(&error_buffer, &source_map);
        return Ok(result);
      }
      Ok((module, comments)) => (module, comments),
    }
  };

  let mut module = module;
  result.shebang = match &mut module {
    Program::Module(module) => module.shebang.take().map(|s| s.to_string()),
    Program::Script(script) => script.shebang.take().map(|s| s.to_string()),
  };

  match &module {
    Program::Module(module) => {
      for item in &module.body {
        if let ModuleItem::Stmt(Stmt::Expr(ExprStmt { expr, .. })) = item {
          if let Expr::Lit(Lit::Str(Str { value, .. })) = &**expr {
            result.directives.push(value.to_string_lossy().into());
            continue;
          }
        }
        break;
      }
    }
    Program::Script(script) => {
      for item in &script.body {
        if let Stmt::Expr(ExprStmt { expr, .. }) = item {
          if let Expr::Lit(Lit::Str(Str { value, .. })) = &**expr {
            result.directives.push(value.to_string_lossy().into());
            continue;
          }
        }
        break;
      }
    }
  }

  if let Some(target) = directive_target(&config.target, &result.directives) {
    config.target = target.clone();
    result.target = Some(target);
  }

  if let Some(options) = config.react_compiler.take() {
    let res = react_compiler(
      &module,
      code,
      &comments,
      &source_map,
      config.is_type_script(),
      config.react_refresh(),
      options,
    );
    if !res.diagnostics.is_empty() {
      result.diagnostics = res.diagnostics;
      return Ok(result);
    }
    if config.trace_bailouts {
      result.bailouts = res.bailouts;
    }
    if let Some(program) = res.program {
      module = program;
    }
  }

  let mut global_deps = vec![];
  let should_inline_fs = config.inline_fs() && code.contains("readFileSync");
  let should_import_swc_helpers = config.source_type() == SourceType::Module;

  let globals = result.ast.globals.clone();
  swc_core::common::GLOBALS.set(&*globals, || {
    let error_buffer = ErrorBuffer::default();
    let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
    swc_core::common::errors::HANDLER.set(&handler, || {
      helpers::HELPERS.set(
        &helpers::Helpers::new(
          /* external helpers from @swc/helpers */ should_import_swc_helpers,
        ),
        || {
          let mut react_options = react::Options::default();
          if config.is_jsx() {
            if let Some(jsx_pragma) = &config.jsx_pragma {
              react_options.pragma = Some(jsx_pragma.clone().into());
            }
            if let Some(jsx_pragma_frag) = &config.jsx_pragma_frag {
              react_options.pragma_frag = Some(jsx_pragma_frag.clone().into());
            }
            react_options.development = Some(config.is_development);
            react_options.refresh = if config.react_refresh() {
              Some(react::RefreshOptions::default())
            } else {
              None
            };

            react_options.runtime = if config.automatic_jsx_runtime {
              if let Some(import_source) = &config.jsx_import_source {
                react_options.import_source = Some(import_source.clone().into());
              }
              Some(react::Runtime::Automatic)
            } else {
              Some(react::Runtime::Classic)
            };
          }

          let global_mark = result.ast.global_mark;
          let unresolved_mark = result.ast.unresolved_mark;
          module.mutate(&mut (
            resolver(unresolved_mark, global_mark, config.is_type_script()),
            // Decorators can use type information, so must run before the TypeScript pass.
            Optional::new(
              decorators::decorators(decorators::Config {
                legacy: true,
                // Always disabled for now, SWC's implementation doesn't match TSC.
                emit_metadata: false,
                // use_define_for_class_fields is ignored here, uses preset-env assumptions instead
                ..Default::default()
              }),
              config.decorators,
            ),
            Optional::new(
              typescript::tsx(
                source_map.clone(),
                Default::default(),
                typescript::TsxConfig {
                  pragma: react_options.pragma.clone(),
                  pragma_frag: react_options.pragma_frag.clone(),
                },
                Some(&comments),
                unresolved_mark,
                global_mark,
              ),
              config.is_type_script() && config.is_jsx(),
            ),
            Optional::new(
              typescript::strip(unresolved_mark, global_mark),
              config.is_type_script() && !config.is_jsx(),
            ),
          ));

          let mut is_module = module.is_module();
          // If it's a script, convert into module. This needs to happen after
          // the resolver (which behaves differently for non-/strict mode).
          let module = match module {
            Program::Module(module) => module,
            Program::Script(script) => Module {
              span: script.span,
              shebang: None,
              body: script.body.into_iter().map(ModuleItem::Stmt).collect(),
            },
          };

          // Most modules don't mention `await` at all. Top-level await makes a file a module even
          // without imports or exports, which the parser otherwise returns as a script.
          result.has_top_level_await =
            code.contains("await") && utils::has_top_level_await(&module);
          is_module |= result.has_top_level_await;

          let mut program = Program::Module(module);
          program.mutate(&mut Optional::new(
            react::react(
              source_map.clone(),
              Some(&comments),
              react_options,
              global_mark,
              unresolved_mark,
            ),
            config.is_jsx(),
          ));
          let mut module = program.expect_module();

          let mut preset_env_config = swc_core::ecma::preset_env::Config {
            dynamic_import: true,
            ..Default::default()
          };
          let versions = config.versions();
          let mut should_run_preset_env = false;
          if !config.is_swc_helpers {
            // Avoid transpiling @swc/helpers so that we don't cause infinite recursion.
            // Filter the versions for preset_env only so that syntax support checks
            // (e.g. in esm2cjs) still work correctly.
            if let Some(versions) = versions {
              should_run_preset_env = true;
              preset_env_config.targets = Some(Targets::Versions(versions));
              preset_env_config.shipped_proposals = true;
              preset_env_config.mode = Some(Entry);
              preset_env_config.bugfixes = true;
            } else {
              preset_env_config.targets = Some(Targets::Versions(Default::default()));
            }
          }

          let mut assumptions = Assumptions::default();
          if config.is_type_script() && !config.use_define_for_class_fields {
            assumptions.set_public_class_fields |= true;
          }

          let mut diagnostics = vec![];
          let mut used_env = HashSet::new();
          if let Some(call_macro) = call_macro {
            let mut errors = Vec::new();
            let mut macros = Macros::new(call_macro, &source_map, &mut errors);
            module = module.fold_with(&mut macros);
            if macros.has_macro_functions() {
              // Macro return values are parsed after the initial resolver pass. Resolve the
              // generated bindings so that minification cannot give declarations in the same
              // scope colliding names.
              module.visit_mut_with(&mut (hygiene(), resolver(unresolved_mark, global_mark, false)));
            }
            for error in errors {
              diagnostics.push(macro_error_to_diagnostic(error, &source_map));
            }
          }

          module.visit_mut_with(&mut (
            Optional::new(
              TypeofReplacer::new(unresolved_mark, config.is_node()),
              config.source_type() != SourceType::Script,
            ),
            // Inline process.env and process.browser,
            Optional::new(
              EnvReplacer {
                replace_env: config.replace_env(),
                env: &config.env,
                is_browser: config.is_browser(),
                used_env: &mut used_env,
                source_map: source_map.clone(),
                diagnostics: &mut diagnostics,
                unresolved_mark,
              },
              config.source_type() != SourceType::Script && !config.is_library(),
            ),
            paren_remover(Some(&comments)),
            // Simplify expressions and remove dead branches so that we
            // don't include dependencies inside conditionals that are always false.
            expr_simplifier(unresolved_mark, Default::default()),
            dead_branch_remover(unresolved_mark),
          ));

          let mut module = module.fold_with(&mut Optional::new(
            inline_fs(
              config.filename,
              unresolved_mark,
              config.project_root,
              fs,
              is_module,
            ),
            should_inline_fs,
          ));

          module.visit_mut_with(
            // Track __dirname and __filename references for the packager in Node env
            &mut Optional::new(
              NodeReplacer {
                unresolved_mark,
                needs_filename: &mut result.needs_filename,
                needs_dirname: &mut result.needs_dirname,
                has_node_replacements: &mut result.has_node_replacements,
              },
              config.is_node(),
            ),
          );

          module.visit_mut_with(
            // Insert dependencies for node globals
            &mut Optional::new(
              GlobalReplacer {
                source_map: source_map.clone(),
                items: &mut global_deps,
                global_mark,
                globals: IndexMap::new(),
                config: &config,
                unresolved_mark,
              },
              config.insert_node_globals(),
            ),
          );

          let mut program = Program::Module(module);
          if should_run_preset_env {
            // Transpile new syntax to older syntax if needed
            program.mutate(&mut transform_from_env(
              unresolved_mark,
              Some(&comments),
              preset_env_config.into(),
              assumptions,
            ));
          }

          // Inject SWC helpers if needed.
          program.mutate(&mut helpers::inject_helpers(global_mark));
          let mut module = program.expect_module();

          // Collect dependencies
          let ignore_mark = Mark::fresh(Mark::root());
          let module = dependency_collector(
            module,
            source_map.clone(),
            &mut result.dependencies,
            ignore_mark,
            unresolved_mark,
            &config,
            &mut diagnostics,
          );

          diagnostics.extend(error_buffer_to_diagnostics(&error_buffer, &source_map));

          if diagnostics
            .iter()
            .any(|d| d.severity == DiagnosticSeverity::Error)
          {
            result.diagnostics = diagnostics;
            return Ok(result);
          }

          let mut collect = Collect::new(
            unresolved_mark,
            ignore_mark,
            config.trace_bailouts,
            is_module,
          );
          module.visit_with(&mut collect);
          if let Some(bailouts) = &collect.bailouts {
            result.bailouts.extend(
              bailouts
                .iter()
                .map(|bailout| bailout.to_diagnostic(&source_map)),
            );
          }

          if matches!(
            config.environment(),
            Environment::ReactClient | Environment::ReactServer
          ) {
            module.visit_with(&mut ReactLazy::new(&collect, &mut result.dependencies));
          }

          let mut needs_esm_helpers = false;
          let mut module = if !config.is_library() || !config.is_esm_output() {
            let (module, needs_helpers, prologue_len) = esm2cjs(
              module,
              unresolved_mark,
              versions,
            );
            needs_esm_helpers = needs_helpers;
            result.esm_prologue_len = prologue_len;
            module
          } else {
            module
          };

          result.dependencies.extend(global_deps);

          // Code blocks rendered in MDX are compiled as separate assets, imported as `mdx-<index>`.
          for dependency in &mut result.dependencies {
            if let Some(asset) = dependency
              .specifier
              .strip_prefix("mdx-")
              .and_then(|index| index.parse::<usize>().ok())
              .and_then(|index| mdx_assets.get(index))
            {
              dependency.resolution =
                DependencyResolution::Deferred(Arc::new(asset.to_request(&config, &dependency.specifier)));
            }
          }

          result.diagnostics = diagnostics;

          // Runtime modules the transformer inserted, whose namespaces the module imports.
          let mut runtime_dependencies = Vec::new();

          if config.react_refresh() && result.dependencies.iter().any(|d| matches!(&*d.specifier, "react" | "react/jsx-runtime" | "react/jsx-dev-runtime" | "@emotion/react" | "@emotion/react/jsx-runtime" | "@emotion/react/jsx-dev-runtime")) {
            result.react_refresh_wrapped = true;
            // `module` and `require` are the module wrapper's, like the module's own references to
            // them, so the packager binds them the same way.
            let unresolved = SyntaxContext::empty().apply_mark(unresolved_mark);
            let module_ident = Ident::new("module".into(), DUMMY_SP, unresolved);
            let require_ident = Ident::new("require".into(), DUMMY_SP, unresolved);
            module.body = vec![
              quote!(
                "var $parcel$ReactRefreshHelpers = $require('@parcel/parcel3/src/react-refresh.js');" as ModuleItem,
                require: Ident = require_ident
              ),
              quote!("$parcel$ReactRefreshHelpers.init()" as ModuleItem),
              quote!("var prevRefreshReg = globalThis.$RefreshReg$;" as ModuleItem),
              quote!("var prevRefreshSig = globalThis.$RefreshSig$;" as ModuleItem),
              quote!("$parcel$ReactRefreshHelpers.prelude($module);" as ModuleItem, module: Ident = module_ident.clone()),
              ModuleItem::Stmt(Stmt::Try(Box::new(TryStmt {
                block: BlockStmt {
                  stmts: module.body
                    .into_iter()
                    .map(|item| item.expect_stmt())
                    .chain(std::iter::once(quote!("$parcel$ReactRefreshHelpers.postlude($module);" as Stmt, module: Ident = module_ident)))
                    .collect(),
                  ..Default::default()
                },
                finalizer: Some(BlockStmt {
                  stmts: vec![
                    quote!("globalThis.$RefreshReg$ = prevRefreshReg;" as Stmt),
                    quote!("globalThis.$RefreshSig$ = prevRefreshSig;" as Stmt)
                  ],
                  ..Default::default()
                }),
                ..Default::default()
              })))
            ];

            runtime_dependencies.push(result.dependencies.len() as u32);
            result.dependencies.push(config.dependency(
              DependencyKind::Require,
              "@parcel/parcel3/src/react-refresh.js",
              SourceType::Module,
              None,
            ));
          }

          if needs_esm_helpers {
            runtime_dependencies.push(result.dependencies.len() as u32);
            result.dependencies.push(config.runtime_dependency(ESM_HELPERS));
          }

          let rsc_runtime = match config.environment() {
            Environment::ReactServer => Some("@parcel/rsc/runtime/server"),
            Environment::ReactClient => Some("@parcel/rsc/runtime/client"),
            _ => None,
          };
          if let Some(specifier) = rsc_runtime
            && !result.directives.iter().any(|d| d == "use parcel-rsc-runtime")
          {
            let mut dependency = config.runtime_dependency(specifier);
            dependency.placeholder = Some("__parcel_rsc_runtime__".into());
            result.rsc_runtime_dep = Some(result.dependencies.len() as u32);
            runtime_dependencies.push(result.dependencies.len() as u32);
            result.dependencies.push(dependency);
          }

          (result.symbols, result.flags) =
            asset_symbols(collect, &result.dependencies, &runtime_dependencies);

          result.ast.program = module;
          if !config.minify() && !config.is_library() {
            result.ast.finalize();
          }
          Ok(result)
        },
      )
    })
  })
}

/// The symbols of a module, given all of its dependencies.
fn asset_symbols(
  collect: Collect,
  dependencies: &[Dependency],
  runtime_dependencies: &[u32],
) -> (AssetSymbols, AssetFlags) {
  let (mut symbols, flags) = if collect.is_static() {
    let flags = collect.asset_flags();
    let indices: HashMap<&str, u32> = dependencies
      .iter()
      .enumerate()
      .map(|(index, dep)| {
        let key = dep.placeholder.as_deref().unwrap_or(&dep.specifier);
        (key, index as u32)
      })
      .collect();
    (
      collect.into_symbols(|source| indices[source.as_str()]),
      flags,
    )
  } else {
    // Could not statically analyze symbols. Assume everything is imported.
    let mut symbols = AssetSymbols::default();
    for (index, dep) in dependencies.iter().enumerate() {
      if matches!(
        dep.specifier_type,
        SpecifierType::Esm | SpecifierType::Commonjs
      ) {
        import_namespace(&mut symbols, index as u32);
      }
    }
    (symbols, AssetFlags::empty())
  };

  for &dep_index in runtime_dependencies {
    import_namespace(&mut symbols, dep_index);
  }
  symbols.imports.sort_by_key(|symbol| symbol.dep_index);
  (symbols, flags)
}

pub type ParseResult<T> = Result<T, Vec<Error>>;

fn parse(
  code: &str,
  filename: PathBuf,
  source_map: &Lrc<SourceMap>,
  config: &Config,
) -> ParseResult<(Program, SwcComments)> {
  let source_file = source_map.new_source_file(Lrc::new(FileName::Real(filename)), code.to_owned());
  let comments = SwcComments::default();
  let syntax = if config.is_type_script() {
    Syntax::Typescript(TsSyntax {
      tsx: config.is_jsx(),
      decorators: config.decorators,
      ..Default::default()
    })
  } else {
    Syntax::Es(EsSyntax {
      jsx: config.is_jsx(),
      export_default_from: true,
      decorators: config.decorators,
      import_attributes: true,
      allow_return_outside_function: true,
      ..Default::default()
    })
  };

  let lexer = Lexer::new(
    syntax,
    Default::default(),
    StringInput::from(&*source_file),
    Some(&comments),
  );

  let mut parser = Parser::new_from(lexer);
  let result = parser.parse_program();

  let module = match result {
    Err(err) => {
      // A fatal error
      return Err(vec![err]);
    }
    Ok(module) => module,
  };
  // Recoverable errors
  let errors = parser.take_errors();
  if !errors.is_empty() {
    return Err(errors);
  }

  Ok((module, comments))
}

fn emit(
  source_map: Lrc<SourceMap>,
  comments: &SwcComments,
  module: &Module,
  source_maps: bool,
  minify: bool,
) -> Result<(Vec<u8>, SourceMapBuffer), std::io::Error> {
  let mut src_map_buf = vec![];
  let mut buf = vec![];
  {
    let writer = Box::new(JsWriter::new(
      source_map.clone(),
      "\n",
      &mut buf,
      if source_maps {
        Some(&mut src_map_buf)
      } else {
        None
      },
    ));
    let config = swc_core::ecma::codegen::Config::default()
      .with_target(swc_core::ecma::ast::EsVersion::Es5)
      // Make sure the output works regardless of whether it's loaded with the correct (utf8) encoding
      .with_ascii_only(true)
      .with_minify(minify);
    let mut emitter = swc_core::ecma::codegen::Emitter {
      cfg: config,
      comments: Some(comments),
      cm: source_map,
      wr: writer,
    };

    emitter.emit_module(module)?;
  }

  Ok((buf, src_map_buf))
}

// Exclude macro expansions from source maps.
struct SourceMapConfig;
impl SourceMapGenConfig for SourceMapConfig {
  fn file_name_to_source(&self, f: &FileName) -> String {
    f.to_string()
  }

  fn skip(&self, f: &FileName) -> bool {
    matches!(f, FileName::MacroExpansion | FileName::Internal(..))
  }

  fn inline_sources_content(&self, _f: &FileName) -> bool {
    true
  }
}

fn macro_error_to_diagnostic(error: MacroError, source_map: &SourceMap) -> Diagnostic {
  let (message, span) = match error {
    MacroError::EvaluationError(span) => {
      ("Could not statically evaluate macro argument".into(), span)
    }
    MacroError::LoadError(err, span) => (format!("Error loading macro: {}", err), span),
    MacroError::ExecutionError(err, span) => (format!("Error evaluating macro: {}", err), span),
    MacroError::ParseError(err) => {
      let error_buffer = ErrorBuffer::default();
      let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
      err.into_diagnostic(&handler).emit();
      let mut diagnostics = error_buffer_to_diagnostics(&error_buffer, source_map);
      return diagnostics.pop().unwrap();
    }
  };

  diagnostic(
    message,
    vec![highlight(source_map, span)],
    DiagnosticSeverity::Error,
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use parcel_macros::JsValue;
  use std::path::Path;
  use swc_core::{
    common::SyntaxContext,
    ecma::{
      ast::{Function, Pat},
      visit::{Visit, VisitWith},
    },
  };

  #[test]
  fn directives_retarget_react_environments_only() {
    let target = |environment| {
      Arc::new(Target {
        environment,
        ..Default::default()
      })
    };
    let use_client = ["use client".into()];
    let use_server = ["use server".into()];

    let client = directive_target(&target(Environment::ReactServer), &use_client).unwrap();
    assert_eq!(client.environment, Environment::ReactClient);
    assert_eq!(client.output_format, OutputFormat::Esmodule);
    let server = directive_target(&target(Environment::ReactClient), &use_server).unwrap();
    assert_eq!(server.environment, Environment::ReactServer);

    // Outside React environments the directives keep the module where it is, so it is compiled
    // for the target it is bundled with.
    assert!(directive_target(&target(Environment::Node), &use_client).is_none());
    assert!(directive_target(&target(Environment::Browser), &use_server).is_none());
    let library = Arc::new(Target {
      environment: Environment::ReactServer,
      flags: EnvironmentFlags::IS_LIBRARY,
      ..Default::default()
    });
    assert!(directive_target(&library, &use_client).is_none());
  }

  #[test]
  fn resolves_bindings_returned_by_macros() {
    let callback = |_, _, _, _| {
      Ok::<_, MacroError>(JsValue::Function(
        "function(first, second) { let result = first + second; return result; }".into(),
      ))
    };
    let result = transform_to_ast(
      Config {
        filename: PathId::new(Path::new("index.js")),
        project_root: PathId::new(Path::new("/")),
        code: br#"
          import {makeFunction} from './macro.js' with {type: 'macro'};
          output = makeFunction();
        "#
        .to_vec(),
        target: Arc::new(Target {
          flags: EnvironmentFlags::SHOULD_OPTIMIZE,
          ..Default::default()
        }),
        ..Default::default()
      },
      &parcel_core::MemoryFileSystem::new(),
      Some(&callback),
    )
    .unwrap();

    struct FunctionBindingContexts(Vec<SyntaxContext>);
    impl Visit for FunctionBindingContexts {
      fn visit_function(&mut self, function: &Function) {
        if function.params.len() == 2
          && matches!(&function.params[0].pat, Pat::Ident(id) if id.id.sym == "first")
          && matches!(&function.params[1].pat, Pat::Ident(id) if id.id.sym == "second")
        {
          self.0.extend(function.params.iter().filter_map(|param| {
            if let Pat::Ident(id) = &param.pat {
              Some(id.id.ctxt)
            } else {
              None
            }
          }));
        }
        function.visit_children_with(self);
      }
    }

    let mut contexts = FunctionBindingContexts(Vec::new());
    result.ast.program.visit_with(&mut contexts);
    assert_eq!(contexts.0.len(), 2);
    assert!(
      contexts
        .0
        .iter()
        .all(|context| *context != SyntaxContext::empty())
    );
  }
}
