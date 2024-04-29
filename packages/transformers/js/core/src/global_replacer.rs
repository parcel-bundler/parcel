use indexmap::IndexMap;
use path_slash::PathBufExt;
use std::path::Path;

use swc_core::common::Mark;
use swc_core::common::SourceMap;
use swc_core::common::SyntaxContext;
use swc_core::common::DUMMY_SP;
use swc_core::ecma::ast::ComputedPropName;
use swc_core::ecma::ast::{self};
use swc_core::ecma::atoms::js_word;
use swc_core::ecma::atoms::JsWord;
use swc_core::ecma::visit::Fold;
use swc_core::ecma::visit::FoldWith;

use crate::dependency_collector::DependencyDescriptor;
use crate::dependency_collector::DependencyKind;
use crate::utils::create_global_decl_stmt;
use crate::utils::create_require;
use crate::utils::is_unresolved;
use crate::utils::SourceLocation;
use crate::utils::SourceType;

pub struct GlobalReplacer<'a> {
  pub source_map: &'a SourceMap,
  pub items: &'a mut Vec<DependencyDescriptor>,
  pub global_mark: Mark,
  pub globals: IndexMap<JsWord, (SyntaxContext, ast::Stmt)>,
  pub project_root: &'a Path,
  pub filename: &'a Path,
  pub unresolved_mark: Mark,
  pub scope_hoist: bool,
}

impl<'a> Fold for GlobalReplacer<'a> {
  fn fold_expr(&mut self, node: ast::Expr) -> ast::Expr {
    use ast::Expr::*;
    use ast::Ident;
    use ast::MemberExpr;
    use ast::MemberProp;

    // Do not traverse into the `prop` side of member expressions unless computed.
    let mut node = match node {
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

    if let Ident(id) = &mut node {
      // Only handle global variables
      if !is_unresolved(&id, self.unresolved_mark) {
        return node;
      }

      let unresolved_mark = self.unresolved_mark;
      match id.sym.to_string().as_str() {
        "process" => {
          if self.update_binding(id, |_| {
            Call(create_require(js_word!("process"), unresolved_mark))
          }) {
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
        }
        "Buffer" => {
          let specifier = swc_core::ecma::atoms::JsWord::from("buffer");
          if self.update_binding(id, |_| {
            Member(MemberExpr {
              obj: Box::new(Call(create_require(specifier.clone(), unresolved_mark))),
              prop: MemberProp::Ident(ast::Ident::new("Buffer".into(), DUMMY_SP)),
              span: DUMMY_SP,
            })
          }) {
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
        }
        "__filename" => {
          self.update_binding(id, |this| {
            let filename =
              if let Some(relative) = pathdiff::diff_paths(this.filename, this.project_root) {
                relative.to_slash_lossy()
              } else if let Some(filename) = this.filename.file_name() {
                format!("/{}", filename.to_string_lossy())
              } else {
                String::from("/unknown.js")
              };
            ast::Expr::Lit(ast::Lit::Str(
              swc_core::ecma::atoms::JsWord::from(filename).into(),
            ))
          });
        }
        "__dirname" => {
          self.update_binding(id, |this| {
            let dirname = if let Some(dirname) = this.filename.parent() {
              if let Some(relative) = pathdiff::diff_paths(dirname, this.project_root) {
                relative.to_slash_lossy()
              } else {
                String::from("/")
              }
            } else {
              String::from("/")
            };
            ast::Expr::Lit(ast::Lit::Str(
              swc_core::ecma::atoms::JsWord::from(dirname).into(),
            ))
          });
        }
        "global" => {
          if !self.scope_hoist {
            self.update_binding(id, |_| {
              ast::Expr::Member(ast::MemberExpr {
                obj: Box::new(Ident(Ident::new(js_word!("arguments"), DUMMY_SP))),
                prop: MemberProp::Computed(ComputedPropName {
                  span: DUMMY_SP,
                  expr: Box::new(Lit(ast::Lit::Num(3.into()))),
                }),
                span: DUMMY_SP,
              })
            });
          }
        }
        _ => {}
      }
    }

    node
  }

  fn fold_module(&mut self, node: ast::Module) -> ast::Module {
    // Insert globals at the top of the program
    let mut node = swc_core::ecma::visit::fold_module(self, node);
    node.body.splice(
      0..0,
      self
        .globals
        .values()
        .map(|(_, stmt)| ast::ModuleItem::Stmt(stmt.clone())),
    );
    node
  }
}

impl GlobalReplacer<'_> {
  fn update_binding<F>(&mut self, id: &mut ast::Ident, expr: F) -> bool
  where
    F: FnOnce(&Self) -> ast::Expr,
  {
    if let Some((ctxt, _)) = self.globals.get(&id.sym) {
      id.span.ctxt = *ctxt;
      false
    } else {
      let (decl, ctxt) = create_global_decl_stmt(id.sym.clone(), expr(self), self.global_mark);

      id.span.ctxt = ctxt;

      self.globals.insert(id.sym.clone(), (ctxt, decl));

      true
    }
  }
}
