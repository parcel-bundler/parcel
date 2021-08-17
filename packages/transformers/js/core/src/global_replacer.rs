use path_slash::PathBufExt;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use swc_atoms::JsWord;
use swc_common::{SourceMap, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast;
use swc_ecmascript::utils::ident::IdentLike;
use swc_ecmascript::visit::{Fold, FoldWith};

use crate::dependency_collector::{DependencyDescriptor, DependencyKind};
use crate::utils::{create_require, SourceLocation, SourceType};

pub struct GlobalReplacer<'a> {
  pub source_map: &'a SourceMap,
  pub items: &'a mut Vec<DependencyDescriptor>,
  pub globals: HashMap<JsWord, ast::Stmt>,
  pub project_root: &'a Path,
  pub filename: &'a Path,
  pub decls: &'a mut HashSet<(JsWord, SyntaxContext)>,
  pub global_mark: swc_common::Mark,
  pub scope_hoist: bool,
  pub is_development: bool,
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

    if let Ident(ref id) = node {
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

          // So it gets renamed during scope hoisting.
          self.decls.insert(id.to_id());

          let specifier = id.sym.clone();
          self.items.push(DependencyDescriptor {
            kind: DependencyKind::Require,
            loc: SourceLocation::from(self.source_map, id.span),
            specifier,
            attributes: None,
            is_optional: false,
            is_helper: false,
            source_type: Some(SourceType::Module),
            placeholder: None,
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

          self.decls.insert(id.to_id());

          self.items.push(DependencyDescriptor {
            kind: DependencyKind::Require,
            loc: SourceLocation::from(self.source_map, id.span),
            specifier,
            attributes: None,
            is_optional: false,
            is_helper: false,
            source_type: Some(SourceType::Module),
            placeholder: None,
          });
        }
        "__filename" => {
          let filename =
            if let Some(relative) = pathdiff::diff_paths(self.filename, self.project_root) {
              relative.to_slash_lossy()
            } else if let Some(filename) = self.filename.file_name() {
              format!("/{}", filename.to_string_lossy())
            } else {
              String::from("/unknown.js")
            };

          self.globals.insert(
            id.sym.clone(),
            create_decl_stmt(
              id.sym.clone(),
              self.global_mark,
              ast::Expr::Lit(ast::Lit::Str(ast::Str {
                span: DUMMY_SP,
                value: swc_atoms::JsWord::from(filename),
                has_escape: false,
                kind: ast::StrKind::Synthesized,
              })),
            ),
          );

          self.decls.insert(id.to_id());
        }
        "__dirname" => {
          let dirname = if let Some(dirname) = self.filename.parent() {
            if let Some(relative) = pathdiff::diff_paths(dirname, self.project_root) {
              relative.to_slash_lossy()
            } else {
              String::from("/")
            }
          } else {
            String::from("/")
          };

          self.globals.insert(
            id.sym.clone(),
            create_decl_stmt(
              id.sym.clone(),
              self.global_mark,
              ast::Expr::Lit(ast::Lit::Str(ast::Str {
                span: DUMMY_SP,
                value: swc_atoms::JsWord::from(dirname),
                has_escape: false,
                kind: ast::StrKind::Synthesized,
              })),
            ),
          );

          self.decls.insert(id.to_id());
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

            self.decls.insert(id.to_id());
          }
        }
        "__DEV__" => {
          return ast::Expr::Lit(ast::Lit::Bool(ast::Bool {
            value: self.is_development,
            span: DUMMY_SP,
          }))
        }
        _ => {}
      }
    }

    node
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
    node
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
