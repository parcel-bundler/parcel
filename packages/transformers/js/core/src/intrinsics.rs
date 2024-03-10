use std::collections::HashMap;
use swc_core::{common::{Mark, DUMMY_SP}, ecma::{ast::{CallExpr, Callee, Decl, Expr, Ident, ImportDecl, MemberProp, Module, ModuleDecl, ModuleItem, Stmt}, visit::{Fold, FoldWith}}};
use swc_core::ecma::atoms::JsWord;
use crate::{collect::Collect, utils::match_require};

pub struct Intrinsics<'a> {
  collect: &'a Collect,
  module_id: &'a str,
  intrinsics: &'a mut HashMap<String, JsWord>,
  unresolved_mark: Mark,
  ignore_mark: Mark
}

impl<'a> Intrinsics<'a> {
  pub fn new(
    collect: &'a Collect,
    module_id: &'a str,
    intrinsics: &'a mut HashMap<String, JsWord>,
    unresolved_mark: Mark,
    ignore_mark: Mark
  ) -> Self {
    Self {
      collect,
      module_id,
      intrinsics,
      unresolved_mark,
      ignore_mark
    }
  }

  fn handle_intrinsic(&mut self, intrinsic: JsWord, call: CallExpr) -> Expr {
    let name = format!("$parcel${}${}", self.module_id, intrinsic);
    let name_word = name.as_str().into();
    self.intrinsics.insert(name, intrinsic.clone());
    Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Ident(Ident::new(name_word, DUMMY_SP)))),
      args: call.args,
      type_args: None,
      span: call.span
    })
  }
}

impl<'a> Fold for Intrinsics<'a> {
  fn fold_expr(&mut self, node: Expr) -> Expr {
    if let Expr::Call(call) = node {
      if let Callee::Expr(expr) = &call.callee {
        match &**expr {
          Expr::Ident(ident) => {
            if let Some(import) = self.collect.imports.get(&ident.to_id()) {
              if import.source == "@parcel/intrinsics" && import.specifier != "*" {
                let imported = import.specifier.clone();
                let call = call.fold_with(self);
                return self.handle_intrinsic(imported, call);
              }
            }
          }
          Expr::Member(member) => 'block: {
            // e.g. ns.intrinsic()
            if let Expr::Ident(ident) = &*member.obj {
              if let Some(import) = self.collect.imports.get(&ident.to_id()) {
                if import.source == "@parcel/intrinsics" && import.specifier == "*" {
                  let imported = match &member.prop {
                    MemberProp::Ident(id) => &id.sym,
                    MemberProp::Computed(_) => break 'block,
                    MemberProp::PrivateName(_) => break 'block,
                  };
  
                  let imported = imported.clone();
                  let call = call.fold_with(self);
                  return self.handle_intrinsic(imported, call);
                }
              }
            }
          }
          _ => {}
        }
      }

      let call = call.fold_with(self);
      return Expr::Call(call)
    }

    node.fold_children_with(self)
  }

  fn fold_stmts(&mut self, mut nodes: Vec<Stmt>) -> Vec<Stmt> {
    nodes = nodes.fold_children_with(self);
    nodes.retain_mut(|node| {
      if let Stmt::Decl(Decl::Var(var)) = node {
        var.decls.retain(|decl| {
          if let Some(init) = &decl.init {
            if let Some(specifier) = match_require(init, self.unresolved_mark, self.ignore_mark) {
              if specifier == "@parcel/intrinsics" {
                return false
              }
            }
          }
          true
        });
        !var.decls.is_empty()
      } else {
        true
      }
    });
    nodes
  }

  fn fold_module(&mut self, mut module: Module) -> Module {
    module.body.retain(|node| {
      if let ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl { src, .. })) = node {
        if src.value == "@parcel/intrinsics" {
          return false
        }
      }
      true
    });
    module.fold_children_with(self)
  }
}
