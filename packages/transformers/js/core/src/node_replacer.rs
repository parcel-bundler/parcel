use path_slash::PathBufExt;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use swc_atoms::JsWord;
use swc_common::{SourceMap, SyntaxContext, DUMMY_SP};
use swc_ecmascript::ast::{self};
use swc_ecmascript::utils::ident::IdentLike;
use swc_ecmascript::visit::{Fold, FoldWith};

use crate::dependency_collector::{DependencyDescriptor, DependencyKind};
use crate::utils::{create_require, SourceLocation, SourceType};

pub struct NodeReplacer<'a> {
  pub source_map: &'a SourceMap,
  pub items: &'a mut Vec<DependencyDescriptor>,
  pub globals: HashMap<JsWord, ast::Stmt>,
  pub project_root: &'a Path,
  pub filename: &'a Path,
  pub decls: &'a mut HashSet<(JsWord, SyntaxContext)>,
  pub global_mark: swc_common::Mark,
  pub scope_hoist: bool,
}

impl<'a> Fold for NodeReplacer<'a> {
  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    use ast::{Expr::*, MemberExpr, MemberProp};

    // Do not traverse into the `prop` side of member expressions unless computed.
    let node = match node {
      Member(expr) => {
        if let MemberProp::Computed(_) = expr.prop {
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
        "__filename" => {
          let specifier = swc_atoms::JsWord::from("path");
          let replace_me_value = swc_atoms::JsWord::from("$parcel$filenameReplace");

          let filename =
            if let Some(relative) = pathdiff::diff_paths(self.filename, self.project_root) {
              relative.to_slash_lossy()
            } else {
              String::from("/unknown.js")
            };

          let inserted_expr = ast::Expr::Call(ast::CallExpr {
            span: DUMMY_SP,
            type_args: None,
            args: vec![
              ast::ExprOrSpread {
                spread: None,
                expr: Box::new(ast::Expr::Ident(ast::Ident {
                  optional: false,
                  span: DUMMY_SP,
                  // This also uses __dirname as later in the path.join call the hierarchy is then correct
                  // Otherwise path.join(__filename, '..') would be one level to shallow (due to the /filename.js at the end)
                  sym: swc_atoms::JsWord::from("__dirname"),
                })),
              },
              ast::ExprOrSpread {
                spread: None,
                expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                  has_escape: false,
                  span: DUMMY_SP,
                  kind: ast::StrKind::Synthesized,
                  value: replace_me_value,
                }))),
              },
              ast::ExprOrSpread {
                spread: None,
                expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                  has_escape: false,
                  span: DUMMY_SP,
                  kind: ast::StrKind::Synthesized,
                  value: swc_atoms::JsWord::from(filename),
                }))),
              },
            ],
            callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
              span: DUMMY_SP,
              obj: (Box::new(Call(create_require(specifier.clone())))),
              prop: MemberProp::Ident(ast::Ident::new("resolve".into(), DUMMY_SP)),
            }))),
          });

          self.globals.insert(
            id.sym.clone(),
            create_decl_stmt(id.sym.clone(), self.global_mark, inserted_expr),
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
        "__dirname" => {
          let specifier = swc_atoms::JsWord::from("path");
          let replace_me_value = swc_atoms::JsWord::from("$parcel$dirnameReplace");

          let inserted_expr = ast::Expr::Call(ast::CallExpr {
            span: DUMMY_SP,
            type_args: None,
            args: vec![
              ast::ExprOrSpread {
                spread: None,
                expr: Box::new(ast::Expr::Ident(ast::Ident {
                  optional: false,
                  span: DUMMY_SP,
                  sym: swc_atoms::JsWord::from("__dirname"),
                })),
              },
              ast::ExprOrSpread {
                spread: None,
                expr: Box::new(ast::Expr::Lit(ast::Lit::Str(ast::Str {
                  has_escape: false,
                  span: DUMMY_SP,
                  kind: ast::StrKind::Synthesized,
                  value: replace_me_value,
                }))),
              },
            ],
            callee: ast::Callee::Expr(Box::new(ast::Expr::Member(ast::MemberExpr {
              span: DUMMY_SP,
              obj: (Box::new(Call(create_require(specifier.clone())))),
              prop: MemberProp::Ident(ast::Ident::new("resolve".into(), DUMMY_SP)),
            }))),
          });

          self.globals.insert(
            id.sym.clone(),
            create_decl_stmt(id.sym.clone(), self.global_mark, inserted_expr),
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
