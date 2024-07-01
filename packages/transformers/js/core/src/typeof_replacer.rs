use swc_core::common::Mark;
use swc_core::ecma::ast::Expr;
use swc_core::ecma::ast::Lit;
use swc_core::ecma::ast::Str;
use swc_core::ecma::ast::UnaryOp;
use swc_core::ecma::atoms::js_word;
use swc_core::ecma::visit::VisitMut;

use crate::utils::is_unresolved;

/// Replaces `typeof module`, `typeof exports` and `typeof require` unary operator expressions
/// with the resulting string literals.
///
/// Requires `unresolved_mark` as passed into `swc_ecma_transform_base::resolver`, which is a mark
/// the SWC transformer will add into variables that are NOT shadowed. This means the `typeof`
/// expression will be replaced at build time with the resulting literal only if it's referring to
/// the global `module`, `exports` and `require` symbols.
pub struct TypeofReplacer {
  pub unresolved_mark: Mark,
}

impl TypeofReplacer {
  fn get_replacement(&mut self, node: &Expr) -> Option<Expr> {
    let Expr::Unary(ref unary) = node else {
      return None;
    };
    if unary.op != UnaryOp::TypeOf {
      return None;
    }
    // typeof require -> "function"
    // typeof module -> "object"
    let Expr::Ident(ident) = &*unary.arg else {
      return None;
    };

    if ident.sym == js_word!("require") && is_unresolved(&ident, self.unresolved_mark) {
      return Some(Expr::Lit(Lit::Str(Str {
        span: unary.span,
        value: js_word!("function"),
        raw: None,
      })));
    }

    if &*ident.sym == "exports" && is_unresolved(&ident, self.unresolved_mark) {
      return Some(Expr::Lit(Lit::Str(Str {
        span: unary.span,
        value: js_word!("object"),
        raw: None,
      })));
    }

    if ident.sym == js_word!("module") && is_unresolved(&ident, self.unresolved_mark) {
      return Some(Expr::Lit(Lit::Str(Str {
        span: unary.span,
        value: js_word!("object"),
        raw: None,
      })));
    }

    None
  }
}

impl VisitMut for TypeofReplacer {
  fn visit_mut_expr(&mut self, node: &mut Expr) {
    let Some(replacement) = self.get_replacement(node) else {
      return;
    };

    *node = replacement;
  }
}

#[cfg(test)]
mod test {
  use swc_core::common::input::StringInput;
  use swc_core::common::sync::Lrc;
  use swc_core::common::{FileName, Globals, SourceMap, GLOBALS};
  use swc_core::ecma::codegen::text_writer::JsWriter;
  use swc_core::ecma::parser::lexer::Lexer;
  use swc_core::ecma::parser::Parser;
  use swc_core::ecma::transforms::base::resolver;
  use swc_core::ecma::visit::{FoldWith, VisitMutWith};

  use super::*;

  #[test]
  fn test_visitor_typeof_replacer_without_shadowing() {
    let code = r#"
const x = typeof require;
const m = typeof module;
const e = typeof exports;
"#;

    let output_code = run_visit(code, |context| TypeofReplacer {
      unresolved_mark: context.unresolved_mark,
    });

    let expected_code = r#"
const x = "function";
const m = "object";
const e = "object";
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
  }

  #[test]
  fn test_visitor_typeof_replacer_with_shadowing() {
    let code = r#"
function wrapper({ require, module, exports }) {
    const x = typeof require;
    const m = typeof module;
    const e = typeof exports;
}
    "#;

    let output_code = run_visit(code, |context| TypeofReplacer {
      unresolved_mark: context.unresolved_mark,
    });

    let expected_code = r#"
function wrapper({ require, module, exports }) {
    const x = typeof require;
    const m = typeof module;
    const e = typeof exports;
}
"#
    .trim_start();
    assert_eq!(output_code, expected_code);
  }

  struct RunTestContext {
    #[allow(unused)]
    global_mark: Mark,
    unresolved_mark: Mark,
  }

  fn run_visit<V: VisitMut>(code: &str, make_visit: impl FnOnce(RunTestContext) -> V) -> String {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(FileName::Anon, code.into());

    let lexer = Lexer::new(
      Default::default(),
      Default::default(),
      StringInput::from(&*source_file),
      None,
    );

    let mut parser = Parser::new_from(lexer);
    let module = parser.parse_module().unwrap();

    let output_code = GLOBALS.set(&Globals::new(), || {
      let global_mark = Mark::new();
      let unresolved_mark = Mark::new();
      let mut module = module.fold_with(&mut resolver(unresolved_mark, global_mark, false));

      let mut visit = make_visit(RunTestContext {
        global_mark,
        unresolved_mark,
      });
      module.visit_mut_with(&mut visit);

      let mut output_buffer = vec![];
      let writer = JsWriter::new(source_map.clone(), "\n", &mut output_buffer, None);
      let mut emitter = swc_core::ecma::codegen::Emitter {
        cfg: Default::default(),
        cm: source_map,
        comments: None,
        wr: writer,
      };
      emitter.emit_module(&module).unwrap();
      let output_code = String::from_utf8(output_buffer).unwrap();
      output_code
    });
    output_code
  }
}
