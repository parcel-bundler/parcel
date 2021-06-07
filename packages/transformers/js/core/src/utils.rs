use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;

pub fn match_member_expr(
  expr: &ast::MemberExpr,
  idents: Vec<&str>,
  decls: &HashSet<(JsWord, SyntaxContext)>,
) -> bool {
  use ast::{Expr::*, ExprOrSuper::*, Ident, Lit, Str};

  let mut member = expr;
  let mut idents = idents;
  while idents.len() > 1 {
    let expected = idents.pop().unwrap();
    let prop = match &*member.prop {
      Lit(Lit::Str(Str { value: ref sym, .. })) => sym,
      Ident(Ident { ref sym, .. }) => {
        if member.computed {
          return false;
        }

        sym
      }
      _ => return false,
    };

    if prop != expected {
      return false;
    }

    match &member.obj {
      Expr(expr) => match &**expr {
        Member(m) => member = m,
        Ident(Ident { ref sym, span, .. }) => {
          return idents.len() == 1
            && sym == idents.pop().unwrap()
            && !decls.contains(&(sym.clone(), span.ctxt()));
        }
        _ => return false,
      },
      _ => return false,
    }
  }

  return false;
}

pub fn create_require(specifier: swc_atoms::JsWord) -> ast::CallExpr {
  ast::CallExpr {
    callee: ast::ExprOrSuper::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
      "require".into(),
      DUMMY_SP,
    )))),
    args: vec![ast::ExprOrSpread {
      expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
        span: DUMMY_SP,
        value: specifier,
        has_escape: false,
        kind: ast::StrKind::Synthesized,
      }))),
      spread: None,
    }],
    span: DUMMY_SP,
    type_args: None,
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

#[derive(Serialize, Deserialize, Debug)]
pub struct CodeHighlight {
  pub message: Option<String>,
  pub loc: SourceLocation,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Diagnostic {
  pub message: String,
  pub code_highlights: Option<Vec<CodeHighlight>>,
  pub hints: Option<Vec<String>>,
}
