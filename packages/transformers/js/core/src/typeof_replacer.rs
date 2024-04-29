use swc_core::common::Mark;
use swc_core::ecma::ast::Expr;
use swc_core::ecma::ast::Lit;
use swc_core::ecma::ast::Str;
use swc_core::ecma::ast::UnaryOp;
use swc_core::ecma::atoms::js_word;
use swc_core::ecma::visit::Fold;
use swc_core::ecma::visit::FoldWith;

use crate::utils::is_unresolved;

pub struct TypeofReplacer {
  pub unresolved_mark: Mark,
}

impl Fold for TypeofReplacer {
  fn fold_expr(&mut self, node: Expr) -> Expr {
    if let Expr::Unary(ref unary) = node {
      // typeof require -> "function"
      // typeof module -> "object"
      if unary.op == UnaryOp::TypeOf {
        if let Expr::Ident(ident) = &*unary.arg {
          if ident.sym == js_word!("require") && is_unresolved(&ident, self.unresolved_mark) {
            return Expr::Lit(Lit::Str(Str {
              span: unary.span,
              value: js_word!("function"),
              raw: None,
            }));
          }
          if &*ident.sym == "exports" && is_unresolved(&ident, self.unresolved_mark) {
            return Expr::Lit(Lit::Str(Str {
              span: unary.span,
              value: js_word!("object"),
              raw: None,
            }));
          }

          if ident.sym == js_word!("module") && is_unresolved(&ident, self.unresolved_mark) {
            return Expr::Lit(Lit::Str(Str {
              span: unary.span,
              value: js_word!("object"),
              raw: None,
            }));
          }
        }
      }
    }
    node.fold_children_with(self)
  }
}
