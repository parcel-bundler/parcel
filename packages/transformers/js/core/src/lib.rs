extern crate swc_common;
extern crate swc_ecma_preset_env;
extern crate swc_ecmascript;
#[macro_use]
extern crate swc_atoms;
extern crate data_encoding;
extern crate dunce;
extern crate inflector;
extern crate path_slash;
extern crate pathdiff;
extern crate serde;
extern crate serde_bytes;
extern crate sha1;

mod decl_collector;
mod dependency_collector;
mod env_replacer;
mod fs;
mod global_replacer;
mod hoist;
mod hoist_collect;
mod modules;
mod utils;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use path_slash::PathExt;
use serde::{Deserialize, Serialize};
use swc_common::comments::SingleThreadedComments;
use swc_common::errors::{DiagnosticBuilder, Emitter, Handler};
use swc_common::DUMMY_SP;
use swc_common::{chain, sync::Lrc, FileName, Globals, Mark, SourceMap};
use swc_ecma_preset_env::{preset_env, Mode::Entry, Targets, Version, Versions};
use swc_ecmascript::ast::{Invalid, Module};
use swc_ecmascript::codegen::text_writer::JsWriter;
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{EsConfig, PResult, Parser, StringInput, Syntax, TsConfig};
use swc_ecmascript::transforms::resolver::resolver_with_mark;
use swc_ecmascript::transforms::{
  compat::reserved_words::reserved_words, fixer, helpers, hygiene,
  optimization::simplify::dead_branch_remover, optimization::simplify::expr_simplifier,
  pass::Optional, proposals::decorators, react, typescript,
};
use swc_ecmascript::visit::{FoldWith, VisitWith};

use decl_collector::*;
use dependency_collector::*;
use env_replacer::*;
use fs::inline_fs;
use global_replacer::GlobalReplacer;
use hoist::{hoist, HoistResult};
use hoist_collect::{HoistCollect, HoistCollectResult};
use modules::esm2cjs;
use utils::{CodeHighlight, Diagnostic, DiagnosticSeverity, SourceLocation, SourceType};

type SourceMapBuffer = Vec<(swc_common::BytePos, swc_common::LineCol)>;

#[derive(Serialize, Debug, Deserialize)]
pub struct Config {
  filename: String,
  #[serde(with = "serde_bytes")]
  code: Vec<u8>,
  module_id: String,
  project_root: String,
  replace_env: bool,
  env: HashMap<swc_atoms::JsWord, swc_atoms::JsWord>,
  inline_fs: bool,
  insert_node_globals: bool,
  is_browser: bool,
  is_worker: bool,
  is_type_script: bool,
  is_jsx: bool,
  jsx_pragma: Option<String>,
  jsx_pragma_frag: Option<String>,
  automatic_jsx_runtime: bool,
  jsx_import_source: Option<String>,
  decorators: bool,
  is_development: bool,
  react_refresh: bool,
  targets: Option<HashMap<String, String>>,
  source_maps: bool,
  scope_hoist: bool,
  source_type: SourceType,
  supports_module_workers: bool,
  is_library: bool,
  is_esm_output: bool,
  trace_bailouts: bool,
}

#[derive(Serialize, Debug, Default)]
pub struct TransformResult {
  #[serde(with = "serde_bytes")]
  code: Vec<u8>,
  map: Option<String>,
  shebang: Option<String>,
  dependencies: Vec<DependencyDescriptor>,
  hoist_result: Option<HoistResult>,
  symbol_result: Option<HoistCollectResult>,
  diagnostics: Option<Vec<Diagnostic>>,
  needs_esm_helpers: bool,
  used_env: HashSet<swc_atoms::JsWord>,
}

fn targets_to_versions(targets: &Option<HashMap<String, String>>) -> Option<Versions> {
  if let Some(targets) = targets {
    macro_rules! set_target {
      ($versions: ident, $name: ident) => {
        let version = targets.get(stringify!($name));
        if let Some(version) = version {
          if let Ok(version) = Version::from_str(version.as_str()) {
            $versions.$name = Some(version);
          }
        }
      };
    }

    let mut versions = Versions::default();
    set_target!(versions, chrome);
    set_target!(versions, opera);
    set_target!(versions, edge);
    set_target!(versions, firefox);
    set_target!(versions, safari);
    set_target!(versions, ie);
    set_target!(versions, ios);
    set_target!(versions, android);
    set_target!(versions, node);
    set_target!(versions, electron);
    return Some(versions);
  }

  None
}

#[derive(Debug, Clone, Default)]
pub struct ErrorBuffer(std::sync::Arc<std::sync::Mutex<Vec<swc_common::errors::Diagnostic>>>);

impl Emitter for ErrorBuffer {
  fn emit(&mut self, db: &DiagnosticBuilder) {
    self.0.lock().unwrap().push((**db).clone());
  }
}

pub fn transform(config: Config) -> Result<TransformResult, std::io::Error> {
  let mut result = TransformResult::default();
  let mut map_buf = vec![];

  let code = unsafe { std::str::from_utf8_unchecked(&config.code) };
  let source_map = Lrc::new(SourceMap::default());
  let module = parse(
    code,
    config.project_root.as_str(),
    config.filename.as_str(),
    &source_map,
    &config,
  );

  match module {
    Err(err) => {
      let error_buffer = ErrorBuffer::default();
      let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
      err.into_diagnostic(&handler).emit();

      let s = error_buffer.0.lock().unwrap().clone();
      let diagnostics: Vec<Diagnostic> = s
        .iter()
        .map(|diagnostic| {
          let message = diagnostic.message();
          let span = diagnostic.span.clone();
          let suggestions = diagnostic.suggestions.clone();

          let span_labels = span.span_labels();
          let code_highlights = if !span_labels.is_empty() {
            let mut highlights = vec![];
            for span_label in span_labels {
              highlights.push(CodeHighlight {
                message: span_label.label,
                loc: SourceLocation::from(&source_map, span_label.span),
              });
            }

            Some(highlights)
          } else {
            None
          };

          let hints = if !suggestions.is_empty() {
            Some(
              suggestions
                .into_iter()
                .map(|suggestion| suggestion.msg)
                .collect(),
            )
          } else {
            None
          };

          Diagnostic {
            message,
            code_highlights,
            hints,
            show_environment: false,
            severity: DiagnosticSeverity::Error,
            documentation_url: None,
          }
        })
        .collect();

      result.diagnostics = Some(diagnostics);
      Ok(result)
    }
    Ok((module, comments)) => {
      let mut module = module;
      result.shebang = match module.shebang {
        Some(shebang) => {
          module.shebang = None;
          Some(shebang.to_string())
        }
        None => None,
      };

      let mut global_deps = vec![];
      let mut fs_deps = vec![];
      let should_inline_fs = config.inline_fs
        && config.source_type != SourceType::Script
        && code.contains("readFileSync");
      swc_common::GLOBALS.set(&Globals::new(), || {
        helpers::HELPERS.set(
          &helpers::Helpers::new(/* external helpers from @swc/helpers */ true),
          || {
            let mut react_options = react::Options::default();
            if config.is_jsx {
              react_options.use_spread = true;
              if let Some(jsx_pragma) = &config.jsx_pragma {
                react_options.pragma = jsx_pragma.clone();
              }
              if let Some(jsx_pragma_frag) = &config.jsx_pragma_frag {
                react_options.pragma_frag = jsx_pragma_frag.clone();
              }
              react_options.development = config.is_development;
              react_options.refresh = if config.react_refresh {
                Some(react::RefreshOptions::default())
              } else {
                None
              };

              react_options.runtime = if config.automatic_jsx_runtime {
                if let Some(import_source) = &config.jsx_import_source {
                  react_options.import_source = import_source.clone();
                }
                Some(react::Runtime::Automatic)
              } else {
                Some(react::Runtime::Classic)
              };
            }

            let global_mark = Mark::fresh(Mark::root());
            let ignore_mark = Mark::fresh(Mark::root());
            module = {
              let mut passes = chain!(
                // Decorators can use type information, so must run before the TypeScript pass.
                Optional::new(
                  decorators::decorators(decorators::Config {
                    legacy: true,
                    // Always disabled for now, SWC's implementation doesn't match TSC.
                    emit_metadata: false
                  }),
                  config.decorators
                ),
                Optional::new(
                  typescript::strip_with_jsx(
                    source_map.clone(),
                    typescript::Config {
                      pragma: Some(react_options.pragma.clone()),
                      pragma_frag: Some(react_options.pragma_frag.clone()),
                      ..Default::default()
                    },
                    Some(&comments),
                    global_mark,
                  ),
                  config.is_type_script && config.is_jsx
                ),
                Optional::new(typescript::strip(), config.is_type_script && !config.is_jsx),
                resolver_with_mark(global_mark),
                Optional::new(
                  react::react(
                    source_map.clone(),
                    Some(&comments),
                    react_options,
                    global_mark
                  ),
                  config.is_jsx
                ),
              );

              module.fold_with(&mut passes)
            };

            let mut decls = collect_decls(&module);

            let mut preset_env_config = swc_ecma_preset_env::Config {
              dynamic_import: true,
              ..Default::default()
            };
            let versions = targets_to_versions(&config.targets);
            if let Some(versions) = versions {
              preset_env_config.targets = Some(Targets::Versions(versions));
              preset_env_config.shipped_proposals = true;
              preset_env_config.mode = Some(Entry);
              preset_env_config.bugfixes = true;
            }

            let mut diagnostics = vec![];
            let module = {
              let mut passes = chain!(
                // Inline process.env and process.browser
                Optional::new(
                  EnvReplacer {
                    replace_env: config.replace_env,
                    env: &config.env,
                    is_browser: config.is_browser,
                    decls: &decls,
                    used_env: &mut result.used_env,
                    source_map: &source_map,
                    diagnostics: &mut diagnostics
                  },
                  config.source_type != SourceType::Script
                ),
                // Simplify expressions and remove dead branches so that we
                // don't include dependencies inside conditionals that are always false.
                expr_simplifier(Default::default()),
                dead_branch_remover(),
                // Inline Node fs.readFileSync calls
                Optional::new(
                  inline_fs(
                    config.filename.as_str(),
                    source_map.clone(),
                    decls.clone(),
                    global_mark,
                    &config.project_root,
                    &mut fs_deps,
                  ),
                  should_inline_fs
                ),
              );

              module.fold_with(&mut passes)
            };

            let module = {
              let mut passes = chain!(
                // Insert dependencies for node globals
                Optional::new(
                  GlobalReplacer {
                    source_map: &source_map,
                    items: &mut global_deps,
                    globals: HashMap::new(),
                    project_root: Path::new(&config.project_root),
                    filename: Path::new(&config.filename),
                    decls: &mut decls,
                    global_mark,
                    scope_hoist: config.scope_hoist
                  },
                  config.insert_node_globals && config.source_type != SourceType::Script
                ),
                // Transpile new syntax to older syntax if needed
                Optional::new(
                  preset_env(global_mark, Some(&comments), preset_env_config),
                  config.targets.is_some()
                ),
                // Inject SWC helpers if needed.
                helpers::inject_helpers(),
              );

              module.fold_with(&mut passes)
            };

            let module = module.fold_with(
              // Collect dependencies
              &mut dependency_collector(
                &source_map,
                &mut result.dependencies,
                &decls,
                ignore_mark,
                &config,
                &mut diagnostics,
              ),
            );

            if diagnostics
              .iter()
              .any(|d| d.severity == DiagnosticSeverity::Error)
            {
              result.diagnostics = Some(diagnostics);
              return Ok(result);
            }

            let module = if config.scope_hoist {
              let res = hoist(
                module,
                source_map.clone(),
                config.module_id.as_str(),
                decls,
                ignore_mark,
                global_mark,
                config.trace_bailouts,
              );
              match res {
                Ok((module, hoist_result, hoist_diagnostics)) => {
                  result.hoist_result = Some(hoist_result);
                  diagnostics.extend(hoist_diagnostics);
                  module
                }
                Err(diagnostics) => {
                  result.diagnostics = Some(diagnostics);
                  return Ok(result);
                }
              }
            } else {
              let mut symbols_collect = HoistCollect::new(
                source_map.clone(),
                decls,
                Mark::fresh(Mark::root()),
                global_mark,
                config.trace_bailouts,
              );
              module.visit_with(&Invalid { span: DUMMY_SP } as _, &mut symbols_collect);

              if let Some(bailouts) = &symbols_collect.bailouts {
                diagnostics.extend(bailouts.iter().map(|bailout| bailout.to_diagnostic()));
              }
              result.symbol_result = Some(symbols_collect.into());

              let (module, needs_helpers) = esm2cjs(module, versions);
              result.needs_esm_helpers = needs_helpers;
              module
            };

            let program = {
              let mut passes = chain!(reserved_words(), hygiene(), fixer(Some(&comments)),);
              module.fold_with(&mut passes)
            };

            result.dependencies.extend(global_deps);
            result.dependencies.extend(fs_deps);

            if !diagnostics.is_empty() {
              result.diagnostics = Some(diagnostics);
            }

            let (buf, mut src_map_buf) =
              emit(source_map.clone(), comments, &program, config.source_maps)?;
            if config.source_maps
              && source_map
                .build_source_map(&mut src_map_buf)
                .to_writer(&mut map_buf)
                .is_ok()
            {
              result.map = Some(String::from_utf8(map_buf).unwrap());
            }
            result.code = buf;
            Ok(result)
          },
        )
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
) -> PResult<(Module, SingleThreadedComments)> {
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
      dynamic_import: true,
      decorators: config.decorators,
      ..Default::default()
    })
  } else {
    Syntax::Es(EsConfig {
      jsx: config.is_jsx,
      dynamic_import: true,
      export_default_from: true,
      export_namespace_from: true,
      import_meta: true,
      decorators: config.decorators,
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
  match parser.parse_module() {
    Err(err) => Err(err),
    Ok(module) => Ok((module, comments)),
  }
}

fn emit(
  source_map: Lrc<SourceMap>,
  comments: SingleThreadedComments,
  program: &Module,
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
    let config = swc_ecmascript::codegen::Config { minify: false };
    let mut emitter = swc_ecmascript::codegen::Emitter {
      cfg: config,
      comments: Some(&comments),
      cm: source_map,
      wr: writer,
    };

    emitter.emit_module(program)?;
  }

  Ok((buf, src_map_buf))
}
