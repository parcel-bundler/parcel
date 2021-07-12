use std::collections::{HashMap, HashSet};
use std::vec;

use swc_atoms::JsWord;
use swc_common::{SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::visit::{Fold, FoldWith};

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
        return node.fold_children_with(self);
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
              if let Some(replacement) = self.replace(sym, true) {
                return replacement;
              }
            } else if let Ident(Ident { ref sym, .. }) = &**prop {
              if !computed {
                if let Some(replacement) = self.replace(sym, true) {
                  return replacement;
                }
              }
            }
          }
        }
      }
    }

    if let Assign(assign) = &node {
      if !self.replace_env || assign.op != ast::AssignOp::Assign {
        return node.fold_children_with(self);
      }

      if let ast::PatOrExpr::Pat(pat) = &assign.left {
        if let ast::Expr::Member(member) = &*assign.right {
          if match_member_expr(member, vec!["process", "env"], self.decls) {
            let mut decls = vec![];
            self.collect_pat_bindings(&pat, &mut decls);

            let mut exprs: Vec<Box<ast::Expr>> = decls
              .iter()
              .map(|decl| {
                Box::new(Assign(ast::AssignExpr {
                  span: DUMMY_SP,
                  op: ast::AssignOp::Assign,
                  left: ast::PatOrExpr::Pat(Box::new(decl.name.clone())),
                  right: Box::new(if let Some(init) = &decl.init {
                    *init.clone()
                  } else {
                    Ident(Ident::new(js_word!("undefined"), DUMMY_SP))
                  }),
                }))
              })
              .collect();

            exprs.push(Box::new(Object(ast::ObjectLit {
              span: DUMMY_SP,
              props: vec![],
            })));

            return Seq(ast::SeqExpr {
              span: assign.span,
              exprs,
            });
          }
        }
      }
    }

    swc_ecmascript::visit::fold_expr(self, node)
  }

  fn fold_var_decl(&mut self, node: ast::VarDecl) -> ast::VarDecl {
    use ast::*;

    if !self.replace_env {
      return node.fold_children_with(self);
    }

    let mut decls = vec![];
    for decl in &node.decls {
      if let Some(init) = &decl.init {
        if let Expr::Member(member) = &**init {
          if match_member_expr(member, vec!["process", "env"], self.decls) {
            self.collect_pat_bindings(&decl.name, &mut decls);
            continue;
          }
        }
      }

      decls.push(decl.clone().fold_with(self));
    }

    VarDecl {
      span: node.span,
      kind: node.kind,
      decls,
      declare: node.declare,
    }
  }
}

impl<'a> EnvReplacer<'a> {
  fn replace(&mut self, sym: &JsWord, fallback_undefined: bool) -> Option<ast::Expr> {
    use ast::{Expr::*, Ident, Lit};

    if let Some(val) = self.env.get(sym) {
      self.used_env.insert(sym.clone());
      return Some(Lit(Lit::Str(ast::Str {
        span: DUMMY_SP,
        value: val.into(),
        has_escape: false,
        kind: ast::StrKind::Synthesized,
      })));
    } else if fallback_undefined {
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

  fn collect_pat_bindings(&mut self, pat: &ast::Pat, decls: &mut Vec<ast::VarDeclarator>) {
    use ast::*;

    match pat {
      Pat::Object(object) => {
        for prop in &object.props {
          match prop {
            ObjectPatProp::KeyValue(kv) => {
              let key = match &kv.key {
                PropName::Ident(ident) => Some(ident.sym.clone()),
                PropName::Str(str) => Some(str.value.clone()),
                // Non-static. E.g. computed property.
                _ => None,
              };

              decls.push(VarDeclarator {
                span: DUMMY_SP,
                name: *kv.value.clone().fold_with(self),
                init: if let Some(key) = key {
                  if let Some(init) = self.replace(&key, false) {
                    Some(Box::new(init))
                  } else {
                    None
                  }
                } else {
                  None
                },
                definite: false,
              });
            }
            ObjectPatProp::Assign(assign) => {
              // let {x} = process.env;
              // let {x = 2} = process.env;
              decls.push(VarDeclarator {
                span: DUMMY_SP,
                name: Pat::Ident(BindingIdent::from(assign.key.clone())),
                init: if let Some(init) = self.replace(&assign.key.sym, false) {
                  Some(Box::new(init))
                } else {
                  assign.value.clone().fold_with(self)
                },
                definite: false,
              })
            }
            ObjectPatProp::Rest(rest) => match &*rest.arg {
              Pat::Ident(ident) => decls.push(VarDeclarator {
                span: DUMMY_SP,
                name: Pat::Ident(ident.clone()),
                init: Some(Box::new(Expr::Object(ObjectLit {
                  span: DUMMY_SP,
                  props: vec![],
                }))),
                definite: false,
              }),
              _ => {}
            },
          }
        }
      }
      Pat::Ident(ident) => decls.push(VarDeclarator {
        span: DUMMY_SP,
        name: Pat::Ident(ident.clone()),
        init: Some(Box::new(Expr::Object(ObjectLit {
          span: DUMMY_SP,
          props: vec![],
        }))),
        definite: false,
      }),
      _ => {}
    }
  }
}
