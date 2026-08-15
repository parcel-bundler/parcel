//! TypeScript transpilation for plugin sources loaded into the QuickJS runtime.
//!
//! This deliberately drives the individual swc passes rather than going through
//! `swc::Compiler::process_js_file`. That entry point is a single dispatcher over
//! swc's whole feature surface — preset_env, every compat transform, the linter,
//! isolated declaration emit, the `.swcrc` config schema — so linking it makes all
//! of that reachable and the linker cannot drop any of it. Plugins only ever need
//! "strip the types, optionally convert to CJS", and doing exactly that is worth
//! ~4.9MB of binary.

use std::path::PathBuf;
use std::sync::Arc;

use swc_core::common::comments::SingleThreadedComments;
use swc_core::common::errors::{DiagnosticBuilder, Emitter as ErrorEmitter, HANDLER, Handler};
use swc_core::common::sync::Lrc;
use swc_core::common::{FileName, GLOBALS, Globals, Mark, SourceMap};
use swc_core::ecma::ast::{EsVersion, Program};
use swc_core::ecma::codegen::text_writer::JsWriter;
use swc_core::ecma::codegen::{Config, Emitter};
use swc_core::ecma::parser::lexer::Lexer;
use swc_core::ecma::parser::{Parser, StringInput, Syntax, TsSyntax};
use swc_core::ecma::transforms::base::fixer::fixer;
use swc_core::ecma::transforms::base::helpers;
use swc_core::ecma::transforms::base::hygiene::hygiene;
use swc_core::ecma::transforms::base::resolver;
use swc_core::ecma::transforms::module::common_js;
use swc_core::ecma::transforms::typescript::typescript;

/// Module format the transpiled output should be emitted in.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ModuleKind {
  /// Rewrite imports/exports to `require`/`exports`.
  CommonJs,
  /// Leave module syntax alone.
  Esm,
}

#[derive(Default, Clone)]
struct ErrorBuffer(Arc<std::sync::Mutex<Vec<String>>>);

impl ErrorEmitter for ErrorBuffer {
  fn emit(&mut self, db: &mut DiagnosticBuilder) {
    self.0.lock().unwrap().push(db.message());
  }
}

/// Strips TypeScript types from `source`, emitting `module_kind`.
///
/// Returns the transpiled source, or the collected diagnostics as a single string.
pub fn transpile_ts(
  filename: &str,
  source: String,
  module_kind: ModuleKind,
) -> Result<String, String> {
  let source_map: Lrc<SourceMap> = Default::default();
  let errors = ErrorBuffer::default();
  let handler = Handler::with_emitter(true, false, Box::new(errors.clone()));

  let file = source_map.new_source_file(Lrc::new(FileName::Real(PathBuf::from(filename))), source);
  let comments = SingleThreadedComments::default();

  let globals = Globals::new();
  let result = GLOBALS.set(&globals, || {
    HANDLER.set(&handler, || {
      helpers::HELPERS.set(&helpers::Helpers::new(false), || {
        let lexer = Lexer::new(
          Syntax::Typescript(TsSyntax::default()),
          EsVersion::latest(),
          StringInput::from(&*file),
          Some(&comments),
        );

        let mut parser = Parser::new_from(lexer);
        let program = match parser.parse_program() {
          Ok(program) => program,
          Err(err) => {
            err.into_diagnostic(&handler).emit();
            return None;
          }
        };
        for err in parser.take_errors() {
          err.into_diagnostic(&handler).emit();
        }
        if handler.has_errors() {
          return None;
        }

        let unresolved_mark = Mark::new();
        let top_level_mark = Mark::new();

        let program = program
          .apply(resolver(unresolved_mark, top_level_mark, true))
          .apply(typescript(
            Default::default(),
            unresolved_mark,
            top_level_mark,
          ));

        let program = match module_kind {
          ModuleKind::CommonJs => program.apply(common_js(
            Default::default(),
            unresolved_mark,
            Default::default(),
            Default::default(),
          )),
          ModuleKind::Esm => program,
        };

        let program = program
          .apply(helpers::inject_helpers(top_level_mark))
          .apply(hygiene())
          .apply(fixer(Some(&comments)));

        Some(emit(program, &source_map, &comments))
      })
    })
  });

  match result {
    Some(code) => Ok(code),
    None => {
      let messages = errors.0.lock().unwrap();
      Err(if messages.is_empty() {
        format!("Failed to transpile {filename}")
      } else {
        messages.join("\n")
      })
    }
  }
}

fn emit(
  program: Program,
  source_map: &Lrc<SourceMap>,
  comments: &SingleThreadedComments,
) -> String {
  let mut buf = Vec::new();
  {
    let writer = JsWriter::new(source_map.clone(), "\n", &mut buf, None);
    let mut emitter = Emitter {
      cfg: Config::default().with_target(EsVersion::latest()),
      comments: Some(comments),
      cm: source_map.clone(),
      wr: writer,
    };
    emitter
      .emit_program(&program)
      .expect("writing to a Vec cannot fail");
  }
  String::from_utf8(buf).expect("swc emits valid utf-8")
}
