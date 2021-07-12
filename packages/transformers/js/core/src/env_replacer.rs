use std::collections::{HashMap, HashSet};

use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::visit::Fold;

use crate::utils::*;

pub struct EnvReplacer<'a> {
  pub replace_env: bool,
  pub is_browser: bool,
  pub env: &'a HashMap<swc_atoms::JsWord, swc_atoms::JsWord>,
  pub decls: &'a HashSet<(JsWord, SyntaxContext)>,
  pub used_env: &'a mut HashSet<JsWord>,
}

impl<'a> Fold for EnvReplacer<'a> {
  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    use ast::{Bool, Expr::*, ExprOrSuper::*, Ident, Lit, MemberExpr, Str};

    // Replace assignments to process.browser with `true`
    // TODO: this seems questionable but we did it in the JS version??
    if let Assign(ref assign) = node {
      if let ast::PatOrExpr::Pat(ref pat) = assign.left {
        if let ast::Pat::Expr(ref expr) = &**pat {
          if let Member(ref member) = &**expr {
            if self.is_browser && match_member_expr(member, vec!["process", "browser"], self.decls)
            {
              let mut res = assign.clone();
              res.right = Box::new(Lit(Lit::Bool(Bool {
                value: true,
                span: DUMMY_SP,
              })));
              return Assign(res);
            }
          }
        }
      }
    }

    if let Member(ref member) = node {
      if self.is_browser && match_member_expr(member, vec!["process", "browser"], self.decls) {
        return Lit(Lit::Bool(Bool {
          value: true,
          span: DUMMY_SP,
        }));
      }

      if !self.replace_env {
        return node;
      }

      if let MemberExpr {
        obj: Expr(ref expr),
        ref prop,
        computed,
        ..
      } = member
      {
        if let Member(member) = &**expr {
          if match_member_expr(member, vec!["process", "env"], self.decls) {
            if let Lit(Lit::Str(Str { value: ref sym, .. })) = &**prop {
              if let Some(replacement) = self.replace(sym) {
                return replacement;
              }
            } else if let Ident(Ident { ref sym, .. }) = &**prop {
              if !computed {
                if let Some(replacement) = self.replace(sym) {
                  return replacement;
                }
              }
            }
          }
        }
      }
    }

    swc_ecmascript::visit::fold_expr(self, node)
  }
}

impl<'a> EnvReplacer<'a> {
  fn replace(&mut self, sym: &JsWord) -> Option<ast::Expr> {
    use ast::{Expr::*, Ident, Lit};

    if let Some(val) = self.env.get(sym) {
      self.used_env.insert(sym.clone());
      return Some(Lit(Lit::Str(ast::Str {
        span: DUMMY_SP,
        value: val.into(),
        has_escape: false,
        kind: ast::StrKind::Synthesized,
      })));
    } else {
      match sym as &str {
        // don't replace process.env.hasOwnProperty with undefined
        "hasOwnProperty"
        | "isPrototypeOf"
        | "propertyIsEnumerable"
        | "toLocaleString"
        | "toSource"
        | "toString"
        | "valueOf" => {}
        _ => {
          self.used_env.insert(sym.clone());
          return Some(Ident(Ident::new(js_word!("undefined"), DUMMY_SP)));
        }
      };
    }
    None
  }
}
