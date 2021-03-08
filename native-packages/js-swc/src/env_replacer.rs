use std::collections::{HashMap, HashSet};

use swc_atoms::JsWord;
use swc_common::{DUMMY_SP, SyntaxContext};
use swc_ecmascript::ast;
use swc_ecmascript::visit::{Fold};

use utils::*;

pub struct EnvReplacer<'a> {
  pub replace_env: bool,
  pub is_browser: bool,
  pub env: HashMap<swc_atoms::JsWord, swc_atoms::JsWord>,
  pub decls: &'a HashSet<(JsWord, SyntaxContext)>
}

impl<'a> Fold for EnvReplacer<'a> {
  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    use ast::{Expr::*, ExprOrSuper::*, Lit, Str, Ident, MemberExpr, Bool};
    
    // Replace assignments to process.browser with `true`
    // TODO: this seems questionable but we did it in the JS version??
    if let Assign(ref assign) = node {
      if let ast::PatOrExpr::Pat(ref pat) = assign.left {
        if let ast::Pat::Expr(ref expr) = &**pat {
          if let Member(ref member) = &**expr {
            if self.is_browser && match_member_expr(member, vec!["process", "browser"], self.decls) {
              let mut res = assign.clone();
              res.right = Box::new(Lit(Lit::Bool(Bool { value: true, span: DUMMY_SP })));
              return Assign(res)
            }
          }
        }
      }
    }
    
    match node {
      Member(ref member) => {
        if self.is_browser && match_member_expr(member, vec!["process", "browser"], self.decls) {
          return Lit(Lit::Bool(Bool { value: true, span: DUMMY_SP }))
        }

        if !self.replace_env {
          return node;
        }

        match member {
          MemberExpr {
            obj: Expr(ref expr),
            ref prop,
            ..
          } => {
            match &**expr {
              Member(member) => {
                if match_member_expr(member, vec!["process", "env"], self.decls) {
                  match &**prop {
                    Lit(Lit::Str(Str { value: ref sym, .. })) |
                    Ident(Ident { ref sym, .. }) => {
                      if let Some(val) = self.env.get(sym) {
                        return Lit(Lit::Str(ast::Str {
                          span: DUMMY_SP,
                          value: val.into(),
                          has_escape: false,
                          kind: ast::StrKind::Synthesized
                        }))
                      } else {
                        return Ident(Ident::new(js_word!("undefined"), DUMMY_SP))
                      }
                    },
                    _ => {},
                  }
                }
              },
              _ => {},
            }
          },
          _ => {},
        }
      },
      _ => {}
    }

    return swc_ecmascript::visit::fold_expr(self, node);
  }
}
