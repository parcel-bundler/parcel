extern crate napi;
#[macro_use]
extern crate napi_derive;
extern crate swc_ecmascript;
extern crate swc_ecma_preset_env;
extern crate swc_common;
#[macro_use]
extern crate swc_atoms;
extern crate serde;

mod decl_collector;
mod dependency_collector;
mod env_replacer;
mod global_replacer;
mod utils;
mod hoist;

use napi::{CallContext, JsString, JsObject, JsUnknown, Result, Error};
use std::collections::{HashMap};
use std::str::FromStr;

use swc_common::comments::SingleThreadedComments;
use swc_common::{FileName, SourceMap, sync::Lrc, chain, Globals, Mark};
use swc_common::errors::{Handler, Emitter, DiagnosticBuilder};
use swc_ecmascript::ast;
use swc_ecmascript::ast::{Module};
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{Parser, EsConfig, TsConfig, StringInput, Syntax, PResult};
use swc_ecmascript::transforms::resolver::resolver_with_mark;
use swc_ecmascript::visit::{FoldWith};
use swc_ecmascript::transforms::{
  modules::common_js,
  helpers,
  fixer,
  hygiene,
  optimization::simplify::expr_simplifier,
  optimization::simplify::dead_branch_remover,
  react,
  typescript,
  pass::Optional
};
use swc_ecmascript::codegen::text_writer::JsWriter;
use swc_ecma_preset_env::{preset_env, Targets, Versions, Version, Mode::Entry};
use serde::{Deserialize, Serialize};

use decl_collector::*;
use dependency_collector::*;
use env_replacer::*;
use global_replacer::GlobalReplacer;
use hoist::hoist;
use utils::SourceLocation;

#[derive(Serialize, Debug, Deserialize)]
struct Config {
  filename: String,
  code: String,
  module_id: String,
  replace_env: bool,
  env: HashMap<swc_atoms::JsWord, swc_atoms::JsWord>,
  is_browser: bool,
  is_type_script: bool,
  is_jsx: bool,
  jsx_pragma: Option<String>,
  jsx_pragma_frag: Option<String>,
  is_development: bool,
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
  diagnostics: Option<Vec<Diagnostic>>
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
    return Some(versions)
  }

  None
}

#[derive(Serialize, Deserialize, Debug)]
struct CodeHighlight {
  message: Option<String>,
  loc: SourceLocation
}

#[derive(Serialize, Deserialize, Debug)]
struct Diagnostic {
  message: String,
  code_highlights: Option<Vec<CodeHighlight>>,
  hints: Option<Vec<String>>
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
  let module = parse(config.code.as_str(), config.filename.as_str(), &source_map, &config);

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
                loc: SourceLocation::from(&source_map, span_label.span)
              });
            }

            Some(highlights)
          } else {
            None
          };

          let hints = if !suggestions.is_empty() {
            Some(suggestions.into_iter().map(|suggestion| suggestion.msg).collect())
          } else {
            None
          };

          Diagnostic {
            message,
            code_highlights,
            hints
          }
        })
        .collect();

      result.diagnostics = Some(diagnostics);
      ctx.env.to_js_value(&result)
    },
    Ok((module, comments)) => {
      let mut module = module;
      result.shebang = match module.shebang {
        Some(shebang) => {
          module.shebang = None;
          Some(shebang.to_string())
        },
        None => None
      };

      let mut global_items = vec![];
      swc_common::GLOBALS.set(&Globals::new(), || {
        helpers::HELPERS.set(&helpers::Helpers::new(false), || {
          let mut react_options = react::Options::default();
          if config.is_jsx {
            if let Some(jsx_pragma) = config.jsx_pragma {
              react_options.pragma = jsx_pragma;
            }
            if let Some(jsx_pragma_frag) = config.jsx_pragma_frag {
              react_options.pragma_frag = jsx_pragma_frag;
            }
            react_options.development = config.is_development;
          }

          module = {
            let mut passes = chain!(
              Optional::new(react::jsx(source_map.clone(), Some(&comments), react_options), config.is_jsx),
              Optional::new(typescript::strip(), config.is_type_script)
            );

            module.fold_with(&mut passes)
          };

          let global_mark = Mark::fresh(Mark::root());
          let ignore_mark = Mark::fresh(Mark::root());
          let module = module.fold_with(&mut resolver_with_mark(global_mark));
          let decls = collect_decls(&module);
    
          let common_js = common_js::common_js(global_mark, swc_ecmascript::transforms::modules::util::Config {
            strict: false,
            strict_mode: false,
            lazy: swc_ecmascript::transforms::modules::util::Lazy::default(),
            no_interop: false,
          });

          let mut preset_env_config = swc_ecma_preset_env::Config::default();
          if let Some(versions) = targets_to_versions(&config.targets) {
            preset_env_config.targets = Some(Targets::Versions(versions));
            preset_env_config.shipped_proposals = true;
            preset_env_config.mode = Some(Entry);
          }
          
          let module = {
            let mut passes = chain!(
              // Inline process.env and process.browser
              EnvReplacer {
                replace_env: config.replace_env,
                env: config.env,
                is_browser: config.is_browser,
                decls: &decls,
              },
              // Simplify expressions and remove dead branches so that we
              // don't include dependencies inside conditionals that are always false.
              expr_simplifier(),
              dead_branch_remover(),
              // Insert dependencies for node globals
              GlobalReplacer {
                source_map: &source_map,
                items: &mut global_items,
                globals: HashMap::new(),
                filename: config.filename.as_str(),
                decls: &decls,
                global_mark,
                scope_hoist: config.scope_hoist
              },
              // Collect dependencies
              dependency_collector(&source_map, &mut result.dependencies, &decls, ignore_mark, config.scope_hoist),
              // Transpile new syntax to older syntax if needed
              Optional::new(preset_env(global_mark, preset_env_config), config.targets.is_some()),
              // Convert ESM to CommonJS if not scope hoisting
              Optional::new(common_js, !config.scope_hoist)
            );

            module.fold_with(&mut passes)
          };

          let module = if config.scope_hoist {
            let (module, hoist_result) = hoist(
              module,
              source_map.clone(),
              config.module_id.as_str(),
              decls,
              ignore_mark,
              global_mark
            );
            result.hoist_result = Some(hoist_result);
            module
          } else {
            module
          };

          let program = {
            let mut passes = chain!(
              helpers::inject_helpers(),
              hygiene(),
              fixer(Some(&comments)),
            );
            module.fold_with(&mut passes)
          };

          result.dependencies.extend(global_items);

          let (buf, mut src_map_buf) = emit(source_map.clone(), comments, &program, config.source_maps)?;
          if config.source_maps {
            let mut map_buf = vec![];
            if let Ok(_) = source_map.build_source_map(&mut src_map_buf).to_writer(&mut map_buf) {
              result.map = Some(String::from_utf8(map_buf).unwrap());
            }
          }
          result.code = String::from_utf8(buf).unwrap();
          ctx.env.to_js_value(&result)
        })
      })
    }
  }
}

fn parse(code: &str, filename: &str, source_map: &Lrc<SourceMap>, config: &Config) -> PResult<(Module, SingleThreadedComments)> {
  let source_file = source_map.new_source_file(
    FileName::Real(filename.into()),
    code.into()
  );

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
    Ok(module) => Ok((module, comments))
  }
}

fn emit(source_map: Lrc<SourceMap>, comments: SingleThreadedComments, program: &Module, source_maps: bool) -> Result<(Vec<u8>, Vec<(swc_common::BytePos, swc_common::LineCol)>)> {
  let mut src_map_buf = vec![];
  let mut buf = vec![];
  {
    let writer = Box::new(
      JsWriter::new(
        source_map.clone(),
        "\n",
        &mut buf,
        if source_maps {
          Some(&mut src_map_buf)
        } else {
          None
        },
      )
    );
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
