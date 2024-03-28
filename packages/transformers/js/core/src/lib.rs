mod collect;
mod constant_module;
mod dependency_collector;
mod env_replacer;
mod fs;
mod global_replacer;
mod hoist;
mod modules;
mod node_replacer;
mod typeof_replacer;
mod utils;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use constant_module::ConstantModule;
use indexmap::IndexMap;
use parcel_macros::{MacroCallback, MacroError, Macros};
use path_slash::PathExt;
use serde::{Deserialize, Serialize};
use swc_core::common::comments::SingleThreadedComments;
use swc_core::common::errors::Handler;
use swc_core::common::pass::Optional;
use swc_core::common::source_map::SourceMapGenConfig;
use swc_core::common::{chain, sync::Lrc, FileName, Globals, Mark, SourceMap};
use swc_core::ecma::ast::{Module, ModuleItem, Program};
use swc_core::ecma::codegen::text_writer::JsWriter;
use swc_core::ecma::parser::lexer::Lexer;
use swc_core::ecma::parser::{EsConfig, PResult, Parser, StringInput, Syntax, TsConfig};
use swc_core::ecma::preset_env::{preset_env, Mode::Entry, Targets};
use swc_core::ecma::transforms::base::fixer::paren_remover;
use swc_core::ecma::transforms::base::helpers;
use swc_core::ecma::transforms::base::{fixer::fixer, hygiene::hygiene, resolver, Assumptions};
use swc_core::ecma::transforms::proposal::decorators;
use swc_core::ecma::transforms::{
  compat::reserved_words::reserved_words, optimization::simplify::dead_branch_remover,
  optimization::simplify::expr_simplifier, react, typescript,
};
use swc_core::ecma::visit::{FoldWith, VisitWith};

use collect::{Collect, CollectResult};
use dependency_collector::*;
use env_replacer::*;
use fs::inline_fs;
use global_replacer::GlobalReplacer;
use hoist::{hoist, HoistResult};
use modules::esm2cjs;
use node_replacer::NodeReplacer;
use typeof_replacer::*;

pub use dependency_collector::{DependencyDescriptor, DependencyKind};
pub use swc_core::ecma::preset_env::{Version, Versions};

use utils::{error_buffer_to_diagnostics, ErrorBuffer};

pub use utils::{CodeHighlight, Diagnostic, DiagnosticSeverity, SourceLocation, SourceType};

type SourceMapBuffer = Vec<(swc_core::common::BytePos, swc_core::common::LineCol)>;

#[derive(Debug)]
pub struct Config<'a> {
  pub filename: PathBuf,
  pub module_id: &'a str,
  pub project_root: &'a str,
  pub replace_env: bool,
  pub env: &'a HashMap<String, String>,
  pub inline_environment: &'a InlineEnvironment,
  pub inline_fs: bool,
  pub insert_node_globals: bool,
  pub node_replacer: bool,
  pub is_browser: bool,
  pub is_worker: bool,
  pub is_type_script: bool,
  pub is_jsx: bool,
  pub jsx_pragma: &'a Option<String>,
  pub jsx_pragma_frag: &'a Option<String>,
  pub automatic_jsx_runtime: bool,
  pub jsx_import_source: &'a Option<String>,
  pub decorators: bool,
  pub use_define_for_class_fields: bool,
  pub is_development: bool,
  pub react_refresh: bool,
  pub targets: Option<Versions>,
  pub source_maps: bool,
  pub scope_hoist: bool,
  pub source_type: SourceType,
  pub supports_module_workers: bool,
  pub is_library: bool,
  pub is_esm_output: bool,
  pub trace_bailouts: bool,
  pub is_swc_helpers: bool,
  pub standalone: bool,
  pub inline_constants: bool,
}

#[derive(Serialize, Debug, Deserialize)]
#[serde(untagged)]
pub enum InlineEnvironment {
  Bool(bool),
  Array(Vec<String>),
}

#[derive(Serialize, Debug, Default)]
pub struct TransformResult {
  #[serde(with = "serde_bytes")]
  pub code: Vec<u8>,
  pub map: Option<String>,
  pub shebang: Option<String>,
  pub dependencies: Vec<DependencyDescriptor>,
  pub hoist_result: Option<HoistResult>,
  pub symbol_result: Option<CollectResult>,
  pub diagnostics: Option<Vec<Diagnostic>>,
  pub needs_esm_helpers: bool,
  pub used_env: HashSet<swc_core::ecma::atoms::JsWord>,
  pub has_node_replacements: bool,
  pub is_constant_module: bool,
}

pub fn transform(
  code: &[u8],
  config: &Config,
  call_macro: Option<MacroCallback>,
) -> TransformResult {
  let mut result = TransformResult::default();
  let mut map_buf = vec![];

  let code = unsafe { std::str::from_utf8_unchecked(&code) };
  let source_map = Lrc::new(SourceMap::default());
  let module = parse(
    code,
    config.project_root,
    config.filename.to_slash_lossy().as_ref(),
    &source_map,
    &config,
  );

  match module {
    Err(err) => {
      let error_buffer = ErrorBuffer::default();
      let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
      err.into_diagnostic(&handler).emit();

      result.diagnostics = Some(error_buffer_to_diagnostics(&error_buffer, &source_map));
      result
    }
    Ok((module, comments)) => {
      let mut module = module;
      result.shebang = match &mut module {
        Program::Module(module) => module.shebang.take().map(|s| s.to_string()),
        Program::Script(script) => script.shebang.take().map(|s| s.to_string()),
      };

      let mut dependencies = IndexMap::new();
      let should_inline_fs = config.inline_fs
        && config.source_type != SourceType::Script
        && code.contains("readFileSync");
      let should_import_swc_helpers = match config.source_type {
        SourceType::Module => true,
        SourceType::Script => false,
      };

      swc_core::common::GLOBALS.set(&Globals::new(), || {
        let error_buffer = ErrorBuffer::default();
        let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
        swc_core::common::errors::HANDLER.set(&handler, || {
          helpers::HELPERS.set(
            &helpers::Helpers::new(
              /* external helpers from @swc/helpers */ should_import_swc_helpers,
            ),
            || {
              let mut react_options = react::Options::default();
              if config.is_jsx {
                if let Some(jsx_pragma) = &config.jsx_pragma {
                  react_options.pragma = Some(jsx_pragma.clone());
                }
                if let Some(jsx_pragma_frag) = &config.jsx_pragma_frag {
                  react_options.pragma_frag = Some(jsx_pragma_frag.clone());
                }
                react_options.development = Some(config.is_development);
                react_options.refresh = if config.react_refresh {
                  Some(react::RefreshOptions::default())
                } else {
                  None
                };

                react_options.runtime = if config.automatic_jsx_runtime {
                  if let Some(import_source) = &config.jsx_import_source {
                    react_options.import_source = Some(import_source.clone());
                  }
                  Some(react::Runtime::Automatic)
                } else {
                  Some(react::Runtime::Classic)
                };
              }

              let global_mark = Mark::fresh(Mark::root());
              let unresolved_mark = Mark::fresh(Mark::root());
              let module = module.fold_with(&mut chain!(
                resolver(unresolved_mark, global_mark, config.is_type_script),
                // Decorators can use type information, so must run before the TypeScript pass.
                Optional::new(
                  decorators::decorators(decorators::Config {
                    legacy: true,
                    // Always disabled for now, SWC's implementation doesn't match TSC.
                    emit_metadata: false,
                    // use_define_for_class_fields is ignored here, uses preset-env assumptions instead
                    ..Default::default()
                  }),
                  config.decorators
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
                    global_mark,
                  ),
                  config.is_type_script && config.is_jsx
                ),
                Optional::new(
                  typescript::strip(global_mark),
                  config.is_type_script && !config.is_jsx
                ),
              ));

              let is_module = module.is_module();
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

              let mut module = module.fold_with(&mut Optional::new(
                react::react(
                  source_map.clone(),
                  Some(&comments),
                  react_options,
                  global_mark,
                  unresolved_mark,
                ),
                config.is_jsx,
              ));

              let mut preset_env_config = swc_core::ecma::preset_env::Config {
                dynamic_import: true,
                ..Default::default()
              };
              let versions = config.targets;
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
                }
              }

              let mut assumptions = Assumptions::default();
              if config.is_type_script && !config.use_define_for_class_fields {
                assumptions.set_public_class_fields |= true;
              }

              let mut diagnostics = vec![];
              if let Some(call_macro) = call_macro {
                let mut errors = Vec::new();
                module = module.fold_with(&mut Macros::new(call_macro, &source_map, &mut errors));
                for error in errors {
                  diagnostics.push(macro_error_to_diagnostic(error, &source_map));
                }
              }

              if config.scope_hoist && config.inline_constants {
                let mut constant_module = ConstantModule::new();
                module.visit_with(&mut constant_module);
                result.is_constant_module = constant_module.is_constant_module;
              }

              let module = {
                let mut passes = chain!(
                  Optional::new(
                    TypeofReplacer { unresolved_mark },
                    config.source_type != SourceType::Script
                  ),
                  // Inline process.env and process.browser
                  Optional::new(
                    EnvReplacer {
                      replace_env: config.replace_env,
                      env: &config.env,
                      inline_environment: &config.inline_environment,
                      is_browser: config.is_browser,
                      used_env: &mut result.used_env,
                      source_map: &source_map,
                      diagnostics: &mut diagnostics,
                      unresolved_mark
                    },
                    config.source_type != SourceType::Script
                  ),
                  paren_remover(Some(&comments)),
                  // Simplify expressions and remove dead branches so that we
                  // don't include dependencies inside conditionals that are always false.
                  expr_simplifier(unresolved_mark, Default::default()),
                  dead_branch_remover(unresolved_mark),
                  // Inline Node fs.readFileSync calls
                  Optional::new(
                    inline_fs(
                      &config.filename,
                      source_map.clone(),
                      unresolved_mark,
                      global_mark,
                      &config.project_root,
                      &mut dependencies,
                      is_module
                    ),
                    should_inline_fs
                  ),
                );

                module.fold_with(&mut passes)
              };

              let module = module.fold_with(
                // Replace __dirname and __filename with placeholders in Node env
                &mut Optional::new(
                  NodeReplacer {
                    source_map: &source_map,
                    items: &mut dependencies,
                    global_mark,
                    globals: HashMap::new(),
                    project_root: &config.project_root,
                    filename: &config.filename,
                    unresolved_mark,
                    scope_hoist: config.scope_hoist,
                    has_node_replacements: &mut result.has_node_replacements,
                  },
                  config.node_replacer,
                ),
              );

              let module = {
                let mut passes = chain!(
                  // Insert dependencies for node globals
                  Optional::new(
                    GlobalReplacer {
                      source_map: &source_map,
                      items: &mut dependencies,
                      global_mark,
                      globals: IndexMap::new(),
                      project_root: &config.project_root,
                      filename: &config.filename,
                      unresolved_mark,
                      scope_hoist: config.scope_hoist
                    },
                    config.insert_node_globals
                  ),
                  // Transpile new syntax to older syntax if needed
                  Optional::new(
                    preset_env(
                      unresolved_mark,
                      Some(&comments),
                      preset_env_config,
                      assumptions,
                      &mut Default::default(),
                    ),
                    should_run_preset_env,
                  ),
                  // Inject SWC helpers if needed.
                  helpers::inject_helpers(global_mark),
                );

                module.fold_with(&mut passes)
              };

              // Flush Id=(JsWord, SyntaxContexts) into unique names and reresolve to
              // set global_mark for all nodes, even generated ones.
              // - This will also remove any other other marks (like ignore_mark)
              // This only needs to be done if preset_env ran because all other transforms
              // insert declarations with global_mark (even though they are generated).
              let module = if config.scope_hoist && should_run_preset_env {
                module.fold_with(&mut chain!(
                  hygiene(),
                  resolver(unresolved_mark, global_mark, false)
                ))
              } else {
                module
              };

              let ignore_mark = Mark::fresh(Mark::root());
              let module = module.fold_with(
                // Collect dependencies
                &mut dependency_collector(
                  &source_map,
                  &mut dependencies,
                  ignore_mark,
                  unresolved_mark,
                  &config,
                  &mut diagnostics,
                ),
              );

              result.dependencies.extend(dependencies.into_values());
              diagnostics.extend(error_buffer_to_diagnostics(&error_buffer, &source_map));

              if diagnostics
                .iter()
                .any(|d| d.severity == DiagnosticSeverity::Error)
              {
                result.diagnostics = Some(diagnostics);
                return result;
              }

              let mut collect = Collect::new(
                source_map.clone(),
                unresolved_mark,
                ignore_mark,
                global_mark,
                config.trace_bailouts,
                is_module,
              );
              module.visit_with(&mut collect);
              if let Some(bailouts) = &collect.bailouts {
                diagnostics.extend(bailouts.iter().map(|bailout| bailout.to_diagnostic()));
              }

              let module = if config.scope_hoist {
                let res = hoist(module, config.module_id, unresolved_mark, &collect);
                match res {
                  Ok((module, hoist_result, hoist_diagnostics)) => {
                    result.hoist_result = Some(hoist_result);
                    diagnostics.extend(hoist_diagnostics);
                    module
                  }
                  Err(diagnostics) => {
                    result.diagnostics = Some(diagnostics);
                    return result;
                  }
                }
              } else {
                // Bail if we could not statically analyze.
                if collect.static_cjs_exports && !collect.should_wrap {
                  result.symbol_result = Some(collect.into());
                }

                let (module, needs_helpers) = esm2cjs(module, unresolved_mark, versions);
                result.needs_esm_helpers = needs_helpers;
                module
              };

              let module = module.fold_with(&mut chain!(
                reserved_words(),
                hygiene(),
                fixer(Some(&comments)),
              ));

              if !diagnostics.is_empty() {
                result.diagnostics = Some(diagnostics);
              }

              let (buf, src_map_buf) =
                match emit(source_map.clone(), comments, &module, config.source_maps) {
                  Err(e) => {
                    result.diagnostics = Some(vec![Diagnostic {
                      message: e.to_string(),
                      code_highlights: None,
                      hints: None,
                      show_environment: false,
                      severity: DiagnosticSeverity::Error,
                      documentation_url: None,
                    }]);
                    return result;
                  }
                  Ok(v) => v,
                };
              if config.source_maps
                && source_map
                  .build_source_map_with_config(&src_map_buf, None, SourceMapConfig)
                  .to_writer(&mut map_buf)
                  .is_ok()
              {
                result.map = Some(String::from_utf8(map_buf).unwrap());
              }
              result.code = buf;
              result
            },
          )
        })
      })
    }
  }
}

fn parse(
  code: &str,
  project_root: &str,
  filename: &str,
  source_map: &Lrc<SourceMap>,
  config: &Config,
) -> PResult<(Program, SingleThreadedComments)> {
  // Attempt to convert the path to be relative to the project root.
  // If outside the project root, use an absolute path so that if the project root moves the path still works.
  let filename: PathBuf = if let Ok(relative) = Path::new(filename).strip_prefix(project_root) {
    relative.to_slash_lossy().into()
  } else {
    filename.into()
  };
  let source_file = source_map.new_source_file(FileName::Real(filename), code.into());

  let comments = SingleThreadedComments::default();
  let syntax = if config.is_type_script {
    Syntax::Typescript(TsConfig {
      tsx: config.is_jsx,
      decorators: config.decorators,
      ..Default::default()
    })
  } else {
    Syntax::Es(EsConfig {
      jsx: config.is_jsx,
      export_default_from: true,
      decorators: config.decorators,
      import_attributes: true,
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
  match parser.parse_program() {
    Err(err) => Err(err),
    Ok(module) => Ok((module, comments)),
  }
}

fn emit(
  source_map: Lrc<SourceMap>,
  comments: SingleThreadedComments,
  module: &Module,
  source_maps: bool,
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
      .with_ascii_only(true);
    let mut emitter = swc_core::ecma::codegen::Emitter {
      cfg: config,
      comments: Some(&comments),
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
}

fn macro_error_to_diagnostic(error: MacroError, source_map: &SourceMap) -> Diagnostic {
  match error {
    MacroError::EvaluationError(span) => Diagnostic {
      message: "Could not statically evaluate macro argument".into(),
      code_highlights: Some(vec![CodeHighlight {
        message: None,
        loc: SourceLocation::from(source_map, span),
      }]),
      hints: None,
      show_environment: false,
      severity: crate::utils::DiagnosticSeverity::Error,
      documentation_url: None,
    },
    MacroError::LoadError(err, span) => Diagnostic {
      message: format!("Error loading macro: {}", err),
      code_highlights: Some(vec![CodeHighlight {
        message: None,
        loc: SourceLocation::from(source_map, span),
      }]),
      hints: None,
      show_environment: false,
      severity: crate::utils::DiagnosticSeverity::Error,
      documentation_url: None,
    },
    MacroError::ExecutionError(err, span) => Diagnostic {
      message: format!("Error evaluating macro: {}", err),
      code_highlights: Some(vec![CodeHighlight {
        message: None,
        loc: SourceLocation::from(source_map, span),
      }]),
      hints: None,
      show_environment: false,
      severity: crate::utils::DiagnosticSeverity::Error,
      documentation_url: None,
    },
    MacroError::ParseError(err) => {
      let error_buffer = ErrorBuffer::default();
      let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
      err.into_diagnostic(&handler).emit();
      let mut diagnostics = error_buffer_to_diagnostics(&error_buffer, source_map);
      return diagnostics.pop().unwrap();
    }
  }
}
