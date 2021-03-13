use std::collections::{HashSet};

use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;

pub fn match_member_expr(expr: &ast::MemberExpr, idents: Vec<&str>, decls: &HashSet<(JsWord, SyntaxContext)>) -> bool {
  use ast::{Expr::*, ExprOrSuper::*, Lit, Str, Ident, MemberExpr};
  
  let mut node = &Member(expr.clone());
  let mut parts = Vec::new();
  loop {
    match node {
      Member(MemberExpr {
        obj: Expr(ref obj),
        ref prop,
        ..
      }) => {
        match &**prop {
          Lit(Lit::Str(Str { value: ref sym, .. })) |
          Ident(Ident { ref sym, .. }) => {
            parts.insert(0, sym);
          },
          _ => {}
        }

        node = &**obj;
      },
      Ident(Ident { ref sym, span, .. }) => {
        // Bail if root identifier is declared in scope.
        if decls.contains(&(sym.clone(), span.ctxt())) {
          return false
        }

        parts.insert(0, sym);
        break
      },
      _ => break
    }
  }
  
  return parts == idents
}

pub fn create_require(specifier: swc_atoms::JsWord, ignore_mark: swc_common::Mark) -> ast::CallExpr {
  ast::CallExpr {
    callee: ast::ExprOrSuper::Expr(
      Box::new(
        ast::Expr::Ident(
          ast::Ident::new("require".into(), DUMMY_SP.apply_mark(ignore_mark))
        )
      )
    ),
    args: vec![ast::ExprOrSpread { expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str { span: DUMMY_SP, value: specifier, has_escape: false, kind: ast::StrKind::Synthesized }))), spread: None }],
    span: DUMMY_SP,
    type_args: None
  }
}
