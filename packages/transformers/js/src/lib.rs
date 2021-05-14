extern crate napi;
#[macro_use]
extern crate napi_derive;
extern crate swc_common;
extern crate swc_ecma_preset_env;
extern crate swc_ecmascript;
#[macro_use]
extern crate swc_atoms;
extern crate data_encoding;
extern crate dunce;
extern crate inflector;
extern crate serde;
extern crate sha1;

#[cfg(target_os = "macos")]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod decl_collector;
mod dependency_collector;
mod env_replacer;
mod fs;
mod global_replacer;
mod hoist;
mod modules;
mod utils;

use napi::{CallContext, JsObject, JsUnknown, Result};
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use swc_common::comments::SingleThreadedComments;
use swc_common::errors::{DiagnosticBuilder, Emitter, Handler};
use swc_common::{chain, sync::Lrc, FileName, Globals, Mark, SourceMap};
use swc_ecma_preset_env::{preset_env, Mode::Entry, Targets, Version, Versions};
use swc_ecmascript::ast;
use swc_ecmascript::ast::Module;
use swc_ecmascript::codegen::text_writer::JsWriter;
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{EsConfig, PResult, Parser, StringInput, Syntax, TsConfig};
use swc_ecmascript::transforms::resolver::resolver_with_mark;
use swc_ecmascript::transforms::{
  compat::reserved_words::reserved_words, fixer, helpers, hygiene,
  optimization::simplify::dead_branch_remover, optimization::simplify::expr_simplifier,
  pass::Optional, react, typescript,
};
use swc_ecmascript::visit::FoldWith;

use decl_collector::*;
use dependency_collector::*;
use env_replacer::*;
use fs::inline_fs;
use global_replacer::GlobalReplacer;
use hoist::hoist;
use modules::esm2cjs;
use utils::{CodeHighlight, Diagnostic, SourceLocation};

#[derive(Serialize, Debug, Deserialize)]
struct Config {
  filename: String,
  code: String,
  module_id: String,
  project_root: String,
  replace_env: bool,
  env: HashMap<swc_atoms::JsWord, swc_atoms::JsWord>,
  inline_fs: bool,
  insert_node_globals: bool,
  is_browser: bool,
  is_type_script: bool,
  is_jsx: bool,
  jsx_pragma: Option<String>,
  jsx_pragma_frag: Option<String>,
  is_development: bool,
  react_refresh: bool,
  targets: Option<HashMap<String, String>>,
  source_maps: bool,
  scope_hoist: bool,
}

#[derive(Serialize, Debug, Deserialize, Default)]
struct TransformResult {
  code: String,
  map: Option<String>,
  shebang: Option<String>,
  dependencies: Vec<DependencyDescriptor>,
  hoist_result: Option<hoist::HoistResult>,
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

#[js_function(1)]
fn transform(ctx: CallContext) -> Result<JsUnknown> {
  let opts = ctx.get::<JsObject>(0)?;
  let config: Config = ctx.env.from_js_value(opts)?;
  let mut result = TransformResult::default();

  let source_map = Lrc::new(SourceMap::default());
  let module = parse(
    config.code.as_str(),
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
          }
        })
        .collect();

      result.diagnostics = Some(diagnostics);
      ctx.env.to_js_value(&result)
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
      swc_common::GLOBALS.set(&Globals::new(), || {
        helpers::HELPERS.set(
          &helpers::Helpers::new(/* external helpers from @swc/helpers */ true),
          || {
            let mut react_options = react::Options::default();
            if config.is_jsx {
              react_options.use_spread = true;
              if let Some(jsx_pragma) = config.jsx_pragma {
                react_options.pragma = jsx_pragma;
              }
              if let Some(jsx_pragma_frag) = config.jsx_pragma_frag {
                react_options.pragma_frag = jsx_pragma_frag;
              }
              react_options.development = config.is_development;
              react_options.refresh = if config.react_refresh {
                Some(react::RefreshOptions::default())
              } else {
                None
              };
            }

            module = {
              let mut passes = chain!(
                Optional::new(
                  react::react(source_map.clone(), Some(&comments), react_options),
                  config.is_jsx
                ),
                Optional::new(typescript::strip(), config.is_type_script)
              );

              module.fold_with(&mut passes)
            };

            let global_mark = Mark::fresh(Mark::root());
            let ignore_mark = Mark::fresh(Mark::root());
            let module = module.fold_with(&mut resolver_with_mark(global_mark));
            let decls = collect_decls(&module);

            let mut preset_env_config = swc_ecma_preset_env::Config::default();
            if let Some(versions) = targets_to_versions(&config.targets) {
              preset_env_config.targets = Some(Targets::Versions(versions));
              preset_env_config.shipped_proposals = true;
              preset_env_config.mode = Some(Entry);
              preset_env_config.bugfixes = true;
            }

            let module = {
              let mut passes = chain!(
                // Inline process.env and process.browser
                EnvReplacer {
                  replace_env: config.replace_env,
                  env: config.env,
                  is_browser: config.is_browser,
                  decls: &decls,
                  used_env: &mut result.used_env
                },
                // Simplify expressions and remove dead branches so that we
                // don't include dependencies inside conditionals that are always false.
                expr_simplifier(),
                dead_branch_remover(),
                // Inline Node fs.readFileSync calls
                Optional::new(
                  inline_fs(
                    config.filename.as_str(),
                    source_map.clone(),
                    decls.clone(),
                    global_mark,
                    config.project_root,
                    &mut fs_deps,
                  ),
                  config.inline_fs && config.code.contains("readFileSync")
                ),
                // Insert dependencies for node globals
                Optional::new(
                  GlobalReplacer {
                    source_map: &source_map,
                    items: &mut global_deps,
                    globals: HashMap::new(),
                    filename: config.filename.as_str(),
                    decls: &decls,
                    global_mark,
                    scope_hoist: config.scope_hoist
                  },
                  config.insert_node_globals
                ),
                // Transpile new syntax to older syntax if needed
                Optional::new(
                  preset_env(global_mark, Some(&comments), preset_env_config),
                  config.targets.is_some()
                ),
                // Inject SWC helpers if needed.
                helpers::inject_helpers(),
                // Collect dependencies
                dependency_collector(
                  &source_map,
                  &mut result.dependencies,
                  &decls,
                  ignore_mark,
                  config.scope_hoist
                ),
              );

              module.fold_with(&mut passes)
            };

            let module = if config.scope_hoist {
              let res = hoist(
                module,
                source_map.clone(),
                config.module_id.as_str(),
                decls,
                ignore_mark,
                global_mark,
              );
              match res {
                Ok((module, hoist_result)) => {
                  result.hoist_result = Some(hoist_result);
                  module
                }
                Err(diagnostics) => {
                  result.diagnostics = Some(diagnostics);
                  return ctx.env.to_js_value(&result);
                }
              }
            } else {
              let (module, needs_helpers) = esm2cjs(module);
              result.needs_esm_helpers = needs_helpers;
              module
            };

            let program = {
              let mut passes = chain!(reserved_words(), hygiene(), fixer(Some(&comments)),);
              module.fold_with(&mut passes)
            };

            result.dependencies.extend(global_deps);
            result.dependencies.extend(fs_deps);

            let (buf, mut src_map_buf) =
              emit(source_map.clone(), comments, &program, config.source_maps)?;
            if config.source_maps {
              let mut map_buf = vec![];
              if let Ok(_) = source_map
                .build_source_map(&mut src_map_buf)
                .to_writer(&mut map_buf)
              {
                result.map = Some(String::from_utf8(map_buf).unwrap());
              }
            }
            result.code = String::from_utf8(buf).unwrap();
            ctx.env.to_js_value(&result)
          },
        )
      })
    }
  }
}

fn parse(
  code: &str,
  filename: &str,
  source_map: &Lrc<SourceMap>,
  config: &Config,
) -> PResult<(Module, SingleThreadedComments)> {
  let source_file = source_map.new_source_file(FileName::Real(filename.into()), code.into());

  let comments = SingleThreadedComments::default();
  let syntax = if config.is_type_script {
    let mut tsconfig = TsConfig::default();
    tsconfig.tsx = config.is_jsx;
    tsconfig.dynamic_import = true;
    Syntax::Typescript(tsconfig)
  } else {
    let mut esconfig = EsConfig::default();
    esconfig.jsx = config.is_jsx;
    esconfig.dynamic_import = true;
    esconfig.export_default_from = true;
    esconfig.export_namespace_from = true;
    esconfig.import_meta = true;
    Syntax::Es(esconfig)
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
) -> Result<(Vec<u8>, Vec<(swc_common::BytePos, swc_common::LineCol)>)> {
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
      cm: source_map.clone(),
      wr: writer,
    };

    emitter.emit_module(&program)?;
  }

  return Ok((buf, src_map_buf));
}

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("transform", transform)?;

  Ok(())
}
