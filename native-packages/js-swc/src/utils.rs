use std::collections::{HashSet};

use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use serde::{Deserialize, Serialize};

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

pub fn create_require(specifier: swc_atoms::JsWord) -> ast::CallExpr {
  ast::CallExpr {
    callee: ast::ExprOrSuper::Expr(
      Box::new(
        ast::Expr::Ident(
          ast::Ident::new("require".into(), DUMMY_SP)
        )
      )
    ),
    args: vec![ast::ExprOrSpread { expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str { span: DUMMY_SP, value: specifier, has_escape: false, kind: ast::StrKind::Synthesized }))), spread: None }],
    span: DUMMY_SP,
    type_args: None
  }
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
pub struct SourceLocation {
  start_line: usize,
  start_col: usize,
  end_line: usize,
  end_col: usize,
}

impl SourceLocation {
  pub fn from(source_map: &swc_common::SourceMap, span: swc_common::Span) -> Self {
    let start = source_map.lookup_char_pos(span.lo);
    let end = source_map.lookup_char_pos(span.hi);
    // - SWC's columns are exclusive, ours are inclusive (column - 1)
    // - SWC has 0-based columns, ours are 1-based (column + 1)
    // = +-0
    SourceLocation {
      start_line: start.line,
      start_col: start.col_display + 1,
      end_line: end.line,
      end_col: end.col_display,
    }
  }
}
