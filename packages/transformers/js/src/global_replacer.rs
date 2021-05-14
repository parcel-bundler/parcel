use std::collections::{HashMap, HashSet};
use std::path::Path;

use swc_atoms::JsWord;
use swc_common::{SourceMap, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::visit::{Fold, FoldWith};

use dependency_collector::{DependencyDescriptor, DependencyKind};
use utils::{create_require, SourceLocation};

pub struct GlobalReplacer<'a> {
  pub source_map: &'a SourceMap,
  pub items: &'a mut Vec<DependencyDescriptor>,
  pub globals: HashMap<JsWord, ast::Stmt>,
  pub filename: &'a str,
  pub decls: &'a HashSet<(JsWord, SyntaxContext)>,
  pub global_mark: swc_common::Mark,
  pub scope_hoist: bool,
}

impl<'a> Fold for GlobalReplacer<'a> {
  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    use ast::{Expr::*, Ident, MemberExpr};

    // Do not traverse into the `prop` side of member expressions unless computed.
    let node = match node {
      Member(expr) => {
        if expr.computed {
          Member(MemberExpr {
            obj: expr.obj.fold_with(self),
            prop: expr.prop.fold_with(self),
            ..expr
          })
        } else {
          Member(MemberExpr {
            obj: expr.obj.fold_with(self),
            ..expr
          })
        }
      }
      _ => node.fold_children_with(self),
    };

    match node {
      Ident(ref id) => {
        // Only handle global variables
        if self.globals.contains_key(&id.sym)
          || self.decls.contains(&(id.sym.clone(), id.span.ctxt()))
        {
          return node;
        }

        match id.sym.to_string().as_str() {
          "process" => {
            self.globals.insert(
              id.sym.clone(),
              create_decl_stmt(
                id.sym.clone(),
                self.global_mark,
                Call(create_require(js_word!("process"))),
              ),
            );

            let specifier = id.sym.clone();
            self.items.push(DependencyDescriptor {
              kind: DependencyKind::Require,
              loc: SourceLocation::from(self.source_map, id.span),
              specifier,
              attributes: None,
              is_optional: false,
              is_helper: false,
            });
          }
          "Buffer" => {
            let specifier = swc_atoms::JsWord::from("buffer");
            self.globals.insert(
              id.sym.clone(),
              create_decl_stmt(
                id.sym.clone(),
                self.global_mark,
                Member(MemberExpr {
                  obj: ast::ExprOrSuper::Expr(Box::new(Call(create_require(specifier.clone())))),
                  prop: Box::new(Ident(ast::Ident::new("Buffer".into(), DUMMY_SP))),
                  computed: false,
                  span: DUMMY_SP,
                }),
              ),
            );

            self.items.push(DependencyDescriptor {
              kind: DependencyKind::Require,
              loc: SourceLocation::from(self.source_map, id.span),
              specifier,
              attributes: None,
              is_optional: false,
              is_helper: false,
            });
          }
          "__filename" => {
            self.globals.insert(
              id.sym.clone(),
              create_decl_stmt(
                id.sym.clone(),
                self.global_mark,
                ast::Expr::Lit(ast::Lit::Str(ast::Str {
                  span: DUMMY_SP,
                  value: swc_atoms::JsWord::from(self.filename),
                  has_escape: false,
                  kind: ast::StrKind::Synthesized,
                })),
              ),
            );
          }
          "__dirname" => {
            self.globals.insert(
              id.sym.clone(),
              create_decl_stmt(
                id.sym.clone(),
                self.global_mark,
                ast::Expr::Lit(ast::Lit::Str(ast::Str {
                  span: DUMMY_SP,
                  value: swc_atoms::JsWord::from(
                    Path::new(self.filename).parent().unwrap().to_str().unwrap(),
                  ),
                  has_escape: false,
                  kind: ast::StrKind::Synthesized,
                })),
              ),
            );
          }
          "global" => {
            if !self.scope_hoist {
              self.globals.insert(
                id.sym.clone(),
                create_decl_stmt(
                  id.sym.clone(),
                  self.global_mark,
                  ast::Expr::Member(ast::MemberExpr {
                    obj: ast::ExprOrSuper::Expr(Box::new(Ident(Ident::new(
                      js_word!("arguments"),
                      DUMMY_SP,
                    )))),
                    prop: Box::new(Lit(ast::Lit::Num(ast::Number {
                      value: 3.0,
                      span: DUMMY_SP,
                    }))),
                    computed: true,
                    span: DUMMY_SP,
                  }),
                ),
              );
            }
          }
          _ => {}
        }
      }
      _ => {}
    }

    return node;
  }

  fn fold_module(&mut self, node: ast::Module) -> ast::Module {
    // Insert globals at the top of the program
    let mut node = swc_ecmascript::visit::fold_module(self, node);
    node.body.splice(
      0..0,
      self
        .globals
        .values()
        .map(|stmt| ast::ModuleItem::Stmt(stmt.clone())),
    );
    return node;
  }
}

fn create_decl_stmt(
  name: swc_atoms::JsWord,
  global_mark: swc_common::Mark,
  init: ast::Expr,
) -> ast::Stmt {
  ast::Stmt::Decl(ast::Decl::Var(ast::VarDecl {
    kind: ast::VarDeclKind::Var,
    declare: false,
    span: DUMMY_SP,
    decls: vec![ast::VarDeclarator {
      name: ast::Pat::Ident(ast::BindingIdent::from(ast::Ident::new(
        name,
        DUMMY_SP.apply_mark(global_mark),
      ))),
      span: DUMMY_SP,
      definite: false,
      init: Some(Box::new(init)),
    }],
  }))
}
