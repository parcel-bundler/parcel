use std::env;
use std::fs;
use std::path::PathBuf;

use swc_core::common::{
  FileName, GLOBALS, Globals, Mark, SourceMap, comments::SingleThreadedComments, errors::HANDLER,
  sync::Lrc,
};
use swc_core::ecma::ast::{EsVersion, Program};
use swc_core::ecma::codegen::{Config, Emitter, text_writer::JsWriter};
use swc_core::ecma::minifier::optimize;
use swc_core::ecma::minifier::option::{
  CompressOptions, ExtraOptions, MangleOptions, MinifyOptions,
};
use swc_core::ecma::parser::{EsSyntax, Parser, StringInput, Syntax, lexer::Lexer};
use swc_core::ecma::transforms::base::resolver;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

const RUNTIME_GLOBALS: &[(&str, &str)] = &[
  ("modules", "m"),
  ("parcelRequireName", "p"),
  ("externals", "x"),
  ("entries", "e"),
  ("mainEntry", "n"),
  ("require", "r"),
];

fn main() {
  println!("cargo:rerun-if-changed=build.rs");
  println!("cargo:rerun-if-changed=src/runtime.js");

  let runtime = fs::read_to_string("src/runtime.js").expect("failed to read src/runtime.js");
  let minified = minify_runtime(&runtime);

  let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is not set"));
  fs::write(out_dir.join("runtime.min.js"), minified).expect("failed to write runtime.min.js");
}

fn minify_runtime(source: &str) -> String {
  let source_map: Lrc<SourceMap> = Default::default();
  let source_file = source_map.new_source_file(
    FileName::Real("runtime.js".into()).into(),
    source.to_string(),
  );
  let comments = SingleThreadedComments::default();

  let globals = Globals::new();
  GLOBALS.set(&globals, || {
    let lexer = Lexer::new(
      Syntax::Es(EsSyntax::default()),
      EsVersion::Es2022,
      StringInput::from(&*source_file),
      Some(&comments),
    );

    let mut parser = Parser::new_from(lexer);
    let mut program = parser.parse_program().unwrap_or_else(|err| {
      HANDLER.with(|handler| err.into_diagnostic(handler).emit());
      panic!("failed to parse src/runtime.js");
    });

    for err in parser.take_errors() {
      HANDLER.with(|handler| err.into_diagnostic(handler).emit());
    }

    let unresolved_mark = Mark::new();
    let top_level_mark = Mark::new();
    program.visit_mut_with(&mut RuntimeAbiRenamer);
    program.visit_mut_with(&mut resolver(unresolved_mark, top_level_mark, false));

    let program = optimize(
      program,
      source_map.clone(),
      Some(&comments),
      None,
      &MinifyOptions {
        rename: true,
        compress: Some(CompressOptions::default()),
        mangle: Some(MangleOptions {
          top_level: Some(true),
          reserved: RUNTIME_GLOBALS
            .iter()
            .map(|(_, minified)| (*minified).into())
            .collect(),
          ..Default::default()
        }),
        ..Default::default()
      },
      &ExtraOptions {
        unresolved_mark,
        top_level_mark,
        mangle_name_cache: None,
      },
    );

    emit_runtime(program, source_map)
  })
}

struct RuntimeAbiRenamer;

impl VisitMut for RuntimeAbiRenamer {
  fn visit_mut_ident(&mut self, node: &mut swc_core::ecma::ast::Ident) {
    for (readable, minified) in RUNTIME_GLOBALS {
      if node.sym == *readable {
        node.sym = (*minified).into();
        break;
      }
    }
  }
}

fn emit_runtime(program: Program, source_map: Lrc<SourceMap>) -> String {
  let mut buf = Vec::new();
  {
    let writer = JsWriter::new(source_map.clone(), "\n", &mut buf, None);
    let mut emitter = Emitter {
      cfg: Config::default()
        .with_target(EsVersion::Es5)
        .with_ascii_only(true)
        .with_minify(true),
      comments: None,
      cm: source_map.clone(),
      wr: writer,
    };

    emitter
      .emit_program(&program)
      .expect("failed to emit runtime.min.js");
  }

  String::from_utf8(buf).expect("runtime.min.js is not valid utf-8")
}
