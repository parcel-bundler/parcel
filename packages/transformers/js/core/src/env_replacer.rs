use std::collections::{HashMap, HashSet};
use std::vec;

use swc_core::common::{Mark, DUMMY_SP};
use swc_core::ecma::ast;
use swc_core::ecma::atoms::JsWord;
use swc_core::ecma::visit::{Fold, FoldWith};

use crate::utils::*;
use ast::*;

pub struct EnvReplacer<'a> {
  pub replace_env: bool,
  pub is_browser: bool,
  pub env: &'a HashMap<swc_core::ecma::atoms::JsWord, swc_core::ecma::atoms::JsWord>,
  pub used_env: &'a mut HashSet<JsWord>,
  pub source_map: &'a swc_core::common::SourceMap,
  pub diagnostics: &'a mut Vec<Diagnostic>,
  pub unresolved_mark: Mark,
}

impl<'a> Fold for EnvReplacer<'a> {
  fn fold_expr(&mut self, node: Expr) -> Expr {
    // Replace assignments to process.browser with `true`
    // TODO: this seems questionable but we did it in the JS version??
    if let Expr::Assign(ref assign) = node {
      if let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &assign.left {
        if self.is_browser
          && match_member_expr(member, vec!["process", "browser"], self.unresolved_mark)
        {
          let mut res = assign.clone();
          res.right = Box::new(Expr::Lit(Lit::Bool(Bool {
            value: true,
            span: DUMMY_SP,
          })));
          return Expr::Assign(res);
        }
      }
    }

    // Replace `'foo' in process.env` with a boolean.
    match &node {
      Expr::Bin(binary) if binary.op == BinaryOp::In => {
        if let (Expr::Lit(Lit::Str(left)), Expr::Member(member)) = (&*binary.left, &*binary.right) {
          if match_member_expr(member, vec!["process", "env"], self.unresolved_mark) {
            return Expr::Lit(Lit::Bool(Bool {
              value: self.env.contains_key(&left.value),
              span: DUMMY_SP,
            }));
          }
        }
      }
      _ => {}
    }

    if let Expr::Member(ref member) = node {
      if self.is_browser
        && match_member_expr(member, vec!["process", "browser"], self.unresolved_mark)
      {
        return Expr::Lit(Lit::Bool(Bool {
          value: true,
          span: DUMMY_SP,
        }));
      }

      if !self.replace_env {
        return node.fold_children_with(self);
      }

      if let Expr::Member(obj) = &*member.obj {
        if match_member_expr(obj, vec!["process", "env"], self.unresolved_mark) {
          if let Some((sym, _)) = match_property_name(member) {
            if let Some(replacement) = self.replace(&sym, true) {
              return replacement;
            }
          }
        }
      }
    }

    if let Expr::Assign(assign) = &node {
      if !self.replace_env {
        return node.fold_children_with(self);
      }

      // process.env.FOO = ...;
      if let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &assign.left {
        if let Expr::Member(obj) = &*member.obj {
          if match_member_expr(obj, vec!["process", "env"], self.unresolved_mark) {
            self.emit_mutating_error(assign.span);
            return *assign.right.clone().fold_with(self);
          }
        }
      }

      if let Expr::Member(member) = &*assign.right {
        if assign.op == AssignOp::Assign
          && match_member_expr(member, vec!["process", "env"], self.unresolved_mark)
        {
          let pat = match &assign.left {
            // ({x, y, z, ...} = process.env);
            AssignTarget::Simple(SimpleAssignTarget::Ident(ident)) => {
              Some(Pat::Ident(ident.clone()))
            }
            // foo = process.env;
            AssignTarget::Pat(AssignTargetPat::Object(obj)) => Some(obj.clone().into()),
            _ => None,
          };
          if let Some(pat) = pat {
            let mut decls = vec![];
            self.collect_pat_bindings(&pat, &mut decls);

            let mut exprs: Vec<Box<Expr>> = decls
              .iter()
              .map(|decl| {
                Box::new(Expr::Assign(AssignExpr {
                  span: DUMMY_SP,
                  op: AssignOp::Assign,
                  left: decl.name.clone().try_into().unwrap(),
                  right: Box::new(if let Some(init) = &decl.init {
                    *init.clone()
                  } else {
                    Expr::Ident(get_undefined_ident(self.unresolved_mark))
                  }),
                }))
              })
              .collect();

            exprs.push(Box::new(Expr::Object(ObjectLit {
              span: DUMMY_SP,
              props: vec![],
            })));

            return Expr::Seq(SeqExpr {
              span: assign.span,
              exprs,
            });
          }
        }
      }
    }

    if self.replace_env {
      match &node {
        // e.g. delete process.env.SOMETHING
        Expr::Unary(UnaryExpr { op: UnaryOp::Delete, arg, span, .. }) |
        // e.g. process.env.UPDATE++
        Expr::Update(UpdateExpr { arg, span, .. }) => {
          if let Expr::Member(MemberExpr { ref obj, .. }) = &**arg {
            if let Expr::Member(member) = &**obj {
              if match_member_expr(member, vec!["process", "env"], self.unresolved_mark) {
                self.emit_mutating_error(*span);
                return match &node {
                  Expr::Unary(_) => Expr::Lit(Lit::Bool(Bool { span: *span, value: true })),
                  Expr::Update(_) => *arg.clone().fold_with(self),
                  _ => unreachable!()
                }
              }
            }
          }
        },
        _ => {}
      }
    }

    node.fold_children_with(self)
  }

  fn fold_var_decl(&mut self, node: VarDecl) -> VarDecl {
    if !self.replace_env {
      return node.fold_children_with(self);
    }

    let mut decls = vec![];
    for decl in &node.decls {
      if let Some(init) = &decl.init {
        if let Expr::Member(member) = &**init {
          if match_member_expr(member, vec!["process", "env"], self.unresolved_mark) {
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
  fn replace(&mut self, sym: &JsWord, fallback_undefined: bool) -> Option<Expr> {
    if let Some(val) = self.env.get(sym) {
      self.used_env.insert(sym.clone());
      return Some(Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: val.clone(),
        raw: None,
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
          return Some(Expr::Ident(get_undefined_ident(self.unresolved_mark)));
        }
      };
    }
    None
  }

  fn collect_pat_bindings(&mut self, pat: &Pat, decls: &mut Vec<VarDeclarator>) {
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
                  self.replace(&key, false).map(Box::new)
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
            ObjectPatProp::Rest(rest) => {
              if let Pat::Ident(ident) = &*rest.arg {
                decls.push(VarDeclarator {
                  span: DUMMY_SP,
                  name: Pat::Ident(ident.clone()),
                  init: Some(Box::new(Expr::Object(ObjectLit {
                    span: DUMMY_SP,
                    props: vec![],
                  }))),
                  definite: false,
                })
              }
            }
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

  fn emit_mutating_error(&mut self, span: swc_core::common::Span) {
    self.diagnostics.push(Diagnostic {
      message: "Mutating process.env is not supported".into(),
      code_highlights: Some(vec![CodeHighlight {
        message: None,
        loc: SourceLocation::from(self.source_map, span),
      }]),
      hints: None,
      show_environment: false,
      severity: DiagnosticSeverity::SourceError,
      documentation_url: None,
    });
  }
}
