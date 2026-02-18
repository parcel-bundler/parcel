use std::{collections::HashSet, path::PathBuf};

use swc_core::{
  common::{
    DUMMY_SP, FileName, Globals, Mark, SourceMap, comments::SingleThreadedComments, sync::Lrc,
    util::take::Take,
  },
  ecma::{
    ast::*,
    atoms::Atom as JsWord,
    codegen::text_writer::JsWriter,
    parser::{EsSyntax, Parser, StringInput, Syntax, lexer::Lexer},
    transforms::base::{fixer::fixer, resolver},
    visit::{VisitMut, VisitMutWith},
  },
};

use crate::{
  SourceMapConfig,
  utils::{is_unresolved, match_member_expr, match_property_name},
};

#[derive(serde::Deserialize)]
pub struct TreeShakeOptions {
  filename: PathBuf,
  #[serde(with = "serde_bytes")]
  code: Vec<u8>,
  used_symbols: HashSet<JsWord>,
}

#[derive(serde::Serialize)]
pub struct TreeShakeResult {
  #[serde(with = "serde_bytes")]
  code: Vec<u8>,
  #[serde(with = "serde_bytes")]
  map: Vec<u8>,
}

pub fn tree_shake(opts: TreeShakeOptions) -> Result<TreeShakeResult, ()> {
  let code = unsafe { std::str::from_utf8_unchecked(&opts.code) };
  let source_map = Lrc::new(SourceMap::default());
  let source_file =
    source_map.new_source_file(Lrc::new(FileName::Real(opts.filename)), code.into());
  let comments = SingleThreadedComments::default();
  let syntax = Syntax::Es(EsSyntax {
    allow_return_outside_function: true,
    ..Default::default()
  });

  let lexer = Lexer::new(
    syntax,
    Default::default(),
    StringInput::from(&*source_file),
    Some(&comments),
  );

  let mut parser = Parser::new_from(lexer);
  let result = parser.parse_program();

  let mut program = match result {
    Err(_) => {
      // A fatal error
      return Err(());
    }
    Ok(module) => module,
  };
  // Recoverable errors
  let errors = parser.take_errors();
  if !errors.is_empty() {
    return Err(());
  }

  swc_core::common::GLOBALS.set(&Globals::new(), || {
    let global_mark = Mark::fresh(Mark::root());
    let unresolved_mark = Mark::fresh(Mark::root());
    program.mutate(&mut resolver(unresolved_mark, global_mark, false));
    let mut shake = TreeShake {
      used_symbols: opts.used_symbols,
      unresolved_mark,
      mutated: false,
    };

    program.visit_mut_with(&mut shake);

    if shake.mutated {
      program.mutate(&mut fixer(Some(&comments)));

      let mut src_map_buf = vec![];
      let mut buf = vec![];
      {
        let writer = Box::new(JsWriter::new(
          source_map.clone(),
          "\n",
          &mut buf,
          Some(&mut src_map_buf),
        ));
        let config = swc_core::ecma::codegen::Config::default()
          .with_target(swc_core::ecma::ast::EsVersion::Es5)
          // Make sure the output works regardless of whether it's loaded with the correct (utf8) encoding
          .with_ascii_only(true);
        let mut emitter = swc_core::ecma::codegen::Emitter {
          cfg: config,
          comments: Some(&comments),
          cm: source_map.clone(),
          wr: writer,
        };

        match emitter.emit_program(&program) {
          Ok(()) => {
            let mut map_buf = Vec::new();
            let _ = source_map
              .build_source_map_with_config(&src_map_buf, None, SourceMapConfig)
              .to_writer(&mut map_buf);

            Ok(TreeShakeResult {
              code: buf,
              map: map_buf,
            })
          }
          Err(_) => return Err(()),
        }
      }
    } else {
      Err(())
    }
  })
}

struct TreeShake {
  used_symbols: HashSet<JsWord>,
  unresolved_mark: Mark,
  mutated: bool,
}

impl VisitMut for TreeShake {
  fn visit_mut_stmt(&mut self, node: &mut Stmt) {
    let Stmt::Expr(stmt) = node else { return };

    match &mut *stmt.expr {
      Expr::Assign(assign) => {
        if let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &assign.left {
          let name = match &*member.obj {
            Expr::Member(obj) => {
              if match_member_expr(obj, vec!["module", "exports"], self.unresolved_mark) {
                if let Some((name, _)) = match_property_name(&member) {
                  name
                } else {
                  return;
                }
              } else {
                return;
              }
            }
            Expr::Ident(ident) => {
              if &*ident.sym == "exports" && is_unresolved(&ident, self.unresolved_mark) {
                if let Some((name, _)) = match_property_name(&member) {
                  name
                } else {
                  return;
                }
              } else {
                return;
              }
            }
            _ => return,
          };

          if !self.used_symbols.contains(&name) {
            println!("TREE SHAKE {}", name);
            stmt.expr = assign.right.take();
            self.mutated = true;
            return;
          }
        }
      }
      Expr::Call(call) => {
        let Callee::Expr(expr) = &call.callee else {
          return;
        };
        let Expr::Member(member) = &**expr else {
          return;
        };

        if !(matches!(&*member.obj, Expr::Ident(id) if id.sym == "parcelHelpers")
          && matches!(match_property_name(&member), Some((name, _)) if name == "export"))
        {
          return;
        }

        let Some(ExprOrSpread { expr, .. }) = call.args.get(1) else {
          return;
        };

        let Expr::Lit(Lit::Str(name)) = &**expr else {
          return;
        };

        if !self.used_symbols.contains(&name.value) {
          println!("TREE SHAKE {}", name.value);
          *node = Stmt::Empty(EmptyStmt { span: DUMMY_SP });
          self.mutated = true;
        }
      }
      _ => {}
    }
  }
}
