// This file is based on code from aleph.js. Original license follows.
// https://github.com/alephjs/aleph.js/blob/51093910bb6d531375f38a539af2588ab10237e1/compiler/src/fast_refresh.rs
//
// The MIT License (MIT)
//
// Copyright (c) 2020-2021 postUI Lab.
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

use sha1::{Digest, Sha1};
use std::rc::Rc;
use std::collections::HashSet;
use swc_common::{SourceMap, Spanned, DUMMY_SP};
use swc_ecmascript::ast::*;
use swc_ecmascript::visit::{noop_fold_type, Fold};
use data_encoding::{BASE64};

/// Shortcut for `quote_ident!(span.apply_mark(Mark::fresh(Mark::root())), s)`
macro_rules! private_ident {
    ($s:expr) => {
        private_ident!(::swc_common::DUMMY_SP, $s)
    };
    ($span:expr, $s:expr) => {{
        use swc_common::Mark;
        let mark = Mark::fresh(Mark::root());
        let span = $span.apply_mark(mark);
        Ident::new($s.into(), span)
    }};
}

macro_rules! quote_ident {
    ($s:expr) => {
        quote_ident!(::swc_common::DUMMY_SP, $s)
    };
    ($span:expr, $s:expr) => {{
        Ident::new($s.into(), $span)
    }};
}

pub fn react_refresh(
  refresh_reg: &str,
  refresh_sig: &str,
  emit_full_signatures: bool,
  source: Rc<SourceMap>,
) -> impl Fold {
  ReactRefreshFold {
    source,
    signature_index: 0,
    registration_index: 0,
    registrations: vec![],
    signatures: vec![],
    refresh_reg: refresh_reg.into(),
    refresh_sig: refresh_sig.into(),
    emit_full_signatures,
  }
}

/// react refresh fold.
///
/// @ref https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js
pub struct ReactRefreshFold {
  source: Rc<SourceMap>,
  signature_index: u32,
  registration_index: u32,
  registrations: Vec<(Ident, String)>,
  signatures: Vec<Signature>,
  refresh_reg: String,
  refresh_sig: String,
  emit_full_signatures: bool,
}

#[derive(Clone, Debug)]
struct Signature {
  parent_ident: Option<Ident>,
  handle_ident: Ident,
  hook_calls: Vec<HookCall>,
}

#[derive(Clone, Debug)]
struct HookCall {
  obj: Option<Ident>,
  ident: Ident,
  key: String,
  is_builtin: bool,
}

impl ReactRefreshFold {
  fn create_registration_handle_ident(&mut self) -> Ident {
    let mut registration_handle_name = String::from("_c");
    self.registration_index += 1;
    if self.registration_index > 1 {
      registration_handle_name.push_str(&self.registration_index.to_string());
    };
    private_ident!(registration_handle_name.as_str())
  }

  fn get_persistent_fn(
    &mut self,
    bindings: &HashSet<String>,
    ident: Option<&Ident>,
    block_stmt: &mut BlockStmt,
  ) -> (Option<Ident>, Option<Signature>) {
    let fc_id = match ident {
      Some(ident) => {
        if is_componentish_name(ident.as_ref()) {
          Some(ident.clone())
        } else {
          None
        }
      }
      None => None,
    };
    let mut bindings_scope = HashSet::<String>::new();
    let mut hook_calls = Vec::<HookCall>::new();
    let mut exotic_signatures = Vec::<(usize, Signature, Option<Expr>)>::new();
    let mut index: usize = 0;
    let stmts = &mut block_stmt.stmts;

    // marge top bindings
    for id in bindings.iter() {
      bindings_scope.insert(id.to_string());
    }

    // collect scope bindings
    stmts.into_iter().for_each(|stmt| {
      match stmt {
        // function useFancyState() {}
        Stmt::Decl(Decl::Fn(FnDecl { ident, .. })) => {
          bindings_scope.insert(ident.sym.as_ref().into());
        }
        Stmt::Decl(Decl::Var(VarDecl { decls, .. })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name: Pat::Ident(BindingIdent { id, .. }),
              init: Some(init_expr),
              ..
            } => match init_expr.as_ref() {
              // const useFancyState = function () {}
              Expr::Fn(_) => {
                bindings_scope.insert(id.sym.as_ref().into());
              }
              // const useFancyState = () => {}
              Expr::Arrow(_) => {
                bindings_scope.insert(id.sym.as_ref().into());
              }
              _ => {}
            },
            _ => {}
          });
        }
        _ => {}
      }
    });

    stmts.into_iter().for_each(|stmt| {
      match stmt {
        // function useFancyState() {}
        Stmt::Decl(Decl::Fn(FnDecl {
          ident,
          function: Function {
            body: Some(body), ..
          },
          ..
        })) => {
          if let (_, Some(signature)) = self.get_persistent_fn(&bindings_scope, Some(ident), body) {
            exotic_signatures.push((index, signature, None));
          }
        }
        // var ...
        Stmt::Decl(Decl::Var(VarDecl { decls, .. })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name,
              init: Some(init_expr),
              ..
            } => match init_expr.as_mut() {
              // const useFancyState = function () {}
              Expr::Fn(FnExpr {
                function: Function {
                  body: Some(body), ..
                },
                ..
              }) => match name {
                Pat::Ident(BindingIdent { id, .. }) => {
                  if let (_, Some(signature)) =
                    self.get_persistent_fn(&bindings_scope, Some(id), body)
                  {
                    exotic_signatures.push((index, signature, None));
                  }
                }
                _ => {}
              },
              // const useFancyState = () => {}
              Expr::Arrow(ArrowExpr {
                body: BlockStmtOrExpr::BlockStmt(body),
                ..
              }) => match name {
                Pat::Ident(BindingIdent { id, .. }) => {
                  if let (_, Some(signature)) =
                    self.get_persistent_fn(&bindings_scope, Some(id), body)
                  {
                    exotic_signatures.push((index, signature, None));
                  }
                }
                _ => {}
              },
              // cosnt [state, setState] = useSate()
              Expr::Call(call) => match self.get_hook_call(Some(name), call) {
                Some(hc) => hook_calls.push(hc),
                _ => {}
              },
              _ => {}
            },
            _ => {}
          });
        }
        // useEffect()
        Stmt::Expr(ExprStmt { expr, .. }) => match expr.as_ref() {
          Expr::Call(call) => match self.get_hook_call(None, call) {
            Some(hc) => hook_calls.push(hc),
            _ => {}
          },
          _ => {}
        },
        // return ..
        Stmt::Return(ReturnStmt { arg: Some(arg), .. }) => match arg.as_mut() {
          // return function() {}
          Expr::Fn(FnExpr {
            function: Function {
              body: Some(body), ..
            },
            ..
          }) => {
            if let (_, Some(signature)) = self.get_persistent_fn(&bindings_scope, None, body) {
              exotic_signatures.push((index, signature, Some(arg.as_ref().clone())));
            }
          }
          // return () => {}
          Expr::Arrow(ArrowExpr {
            body: BlockStmtOrExpr::BlockStmt(body),
            ..
          }) => {
            if let (_, Some(signature)) = self.get_persistent_fn(&bindings_scope, None, body) {
              exotic_signatures.push((index, signature, Some(arg.as_ref().clone())));
            }
          }
          _ => {}
        },
        _ => {}
      }
      index += 1;
    });

    // ! insert
    // _s();
    let mut inserted: usize = 0;
    let signature = if hook_calls.len() > 0 {
      let mut handle_ident = String::from("_s");
      self.signature_index += 1;
      if self.signature_index > 1 {
        handle_ident.push_str(self.signature_index.to_string().as_str());
      };
      let handle_ident = private_ident!(handle_ident.as_str());
      block_stmt.stmts.insert(
        0,
        Stmt::Expr(ExprStmt {
          span: DUMMY_SP,
          expr: Box::new(Expr::Call(CallExpr {
            span: DUMMY_SP,
            callee: ExprOrSuper::Expr(Box::new(Expr::Ident(handle_ident.clone()))),
            args: vec![],
            type_args: None,
          })),
        }),
      );
      inserted += 1;
      Some(Signature {
        parent_ident: match ident {
          Some(ident) => Some(ident.clone()),
          None => None,
        },
        handle_ident,
        hook_calls,
      })
    } else {
      None
    };

    if exotic_signatures.len() > 0 {
      // ! insert
      // var _s = $RefreshSig$(), _s2 = $RefreshSig$();
      block_stmt.stmts.insert(
        inserted,
        Stmt::Decl(Decl::Var(VarDecl {
          span: DUMMY_SP,
          kind: VarDeclKind::Var,
          declare: false,
          decls: exotic_signatures
            .clone()
            .into_iter()
            .map(|signature| VarDeclarator {
              span: DUMMY_SP,
              name: Pat::Ident(BindingIdent {
                id: signature.1.handle_ident,
                type_ann: None,
              }),
              init: Some(Box::new(Expr::Call(CallExpr {
                span: DUMMY_SP,
                callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
                  .refresh_sig
                  .as_str())))),
                args: vec![],
                type_args: None,
              }))),
              definite: false,
            })
            .collect(),
        })),
      );
      inserted += 1;

      for (index, exotic_signature, return_expr) in exotic_signatures {
        let mut args = self.create_arguments_for_signature(&bindings_scope, &exotic_signature);
        if let Some(return_expr) = return_expr {
          args.insert(
            0,
            ExprOrSpread {
              spread: None,
              expr: Box::new(return_expr),
            },
          );
          block_stmt.stmts[index + inserted] = Stmt::Return(ReturnStmt {
            span: DUMMY_SP,
            arg: Some(Box::new(Expr::Call(CallExpr {
              span: DUMMY_SP,
              callee: ExprOrSuper::Expr(Box::new(Expr::Ident(
                exotic_signature.handle_ident.clone(),
              ))),
              args,
              type_args: None,
            }))),
          });
        } else {
          block_stmt.stmts.insert(
            index + inserted + 1,
            Stmt::Expr(ExprStmt {
              span: DUMMY_SP,
              expr: Box::new(Expr::Call(CallExpr {
                span: DUMMY_SP,
                callee: ExprOrSuper::Expr(Box::new(Expr::Ident(
                  exotic_signature.handle_ident.clone(),
                ))),
                args,
                type_args: None,
              })),
            }),
          );
          inserted += 1
        }
      }
    }
    (fc_id, signature)
  }

  fn get_hook_call(&self, pat: Option<&Pat>, call: &CallExpr) -> Option<HookCall> {
    if let Some((obj, ident)) = get_call_callee(call) {
      let ident_str = ident.sym.as_ref();
      let is_builtin = is_builtin_hook(
        match &obj {
          Some(obj) => Some(obj),
          None => None,
        },
        ident_str,
      );
      if is_builtin
        || (ident_str.len() > 3
          && ident_str.starts_with("use")
          && ident_str[3..].starts_with(char::is_uppercase))
      {
        let mut key = ident_str.to_owned();
        match pat {
          Some(pat) => {
            let name = self.source.span_to_snippet(pat.span()).unwrap();
            key.push('{');
            key.push_str(name.as_str());
            // `useState` first argument is initial state.
            if call.args.len() > 0 && is_builtin && ident_str == "useState" {
              key.push('(');
              key.push_str(
                self
                  .source
                  .span_to_snippet(call.args[0].span())
                  .unwrap()
                  .as_str(),
              );
              key.push(')');
            }
            // `useReducer` second argument is initial state.
            if call.args.len() > 1 && is_builtin && ident_str == "useReducer" {
              key.push('(');
              key.push_str(
                self
                  .source
                  .span_to_snippet(call.args[1].span())
                  .unwrap()
                  .as_str(),
              );
              key.push(')');
            }
            key.push('}');
          }
          _ => key.push_str("{}"),
        };
        return Some(HookCall {
          obj,
          ident,
          key,
          is_builtin,
        });
      }
    }
    None
  }

  fn find_inner_component(
    &mut self,
    bindings: &HashSet<String>,
    parent_name: &str,
    call: &mut CallExpr,
  ) -> bool {
    if !is_componentish_name(parent_name) && !parent_name.starts_with("%default%") {
      return false;
    }

    if call.args.len() == 0 {
      return false;
    }

    // first arg should be a function or call
    match call.args[0].expr.as_ref() {
      Expr::Fn(_) => {}
      Expr::Arrow(_) => {}
      Expr::Call(_) => {}
      _ => return false,
    }

    if let Some((obj, ident)) = get_call_callee(call) {
      let mut ident_str = parent_name.to_owned();
      ident_str.push('$');
      match obj {
        Some(obj) => {
          ident_str.push_str(obj.sym.as_ref());
          ident_str.push('.');
        }
        _ => {}
      }
      ident_str.push_str(ident.sym.as_ref());
      match call.args[0].expr.as_mut() {
        Expr::Call(inner_call) => {
          if let Some(_) = get_call_callee(inner_call) {
            let ok = self.find_inner_component(bindings, ident_str.as_str(), inner_call);
            if ok {
              let handle_ident = self.create_registration_handle_ident();
              self
                .registrations
                .push((handle_ident.clone(), ident_str.clone()));
              call.args[0] = ExprOrSpread {
                spread: None,
                expr: Box::new(Expr::Assign(AssignExpr {
                  span: DUMMY_SP,
                  op: AssignOp::Assign,
                  left: PatOrExpr::Expr(Box::new(Expr::Ident(handle_ident))),
                  right: Box::new(Expr::Call(inner_call.clone())),
                })),
              }
            }
            return ok;
          }
        }
        _ => {}
      }

      let handle_ident = self.create_registration_handle_ident();
      self.registrations.push((handle_ident.clone(), ident_str));
      match call.args[0].expr.as_mut() {
        Expr::Fn(fn_expr) => {
          let mut right = Box::new(Expr::Fn(fn_expr.clone()));
          match &mut fn_expr.function {
            Function {
              body: Some(body), ..
            } => {
              if let (_, Some(signature)) = self.get_persistent_fn(bindings, None, body) {
                let mut args = self.create_arguments_for_signature(bindings, &signature);
                args.insert(
                  0,
                  ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Fn(fn_expr.clone())),
                  },
                );
                right = Box::new(Expr::Call(CallExpr {
                  span: DUMMY_SP,
                  callee: ExprOrSuper::Expr(Box::new(Expr::Ident(signature.handle_ident.clone()))),
                  args,
                  type_args: None,
                }));
                self.signatures.push(signature);
              }
            }
            _ => {}
          };
          call.args[0] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Assign(AssignExpr {
              span: DUMMY_SP,
              op: AssignOp::Assign,
              left: PatOrExpr::Expr(Box::new(Expr::Ident(handle_ident))),
              right,
            })),
          }
        }
        Expr::Arrow(arrow_expr) => {
          let mut right = Box::new(Expr::Arrow(arrow_expr.clone()));
          match &mut arrow_expr.body {
            BlockStmtOrExpr::BlockStmt(body) => {
              if let (_, Some(signature)) = self.get_persistent_fn(bindings, None, body) {
                let mut args = self.create_arguments_for_signature(bindings, &signature);
                args.insert(
                  0,
                  ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Arrow(arrow_expr.clone())),
                  },
                );
                right = Box::new(Expr::Call(CallExpr {
                  span: DUMMY_SP,
                  callee: ExprOrSuper::Expr(Box::new(Expr::Ident(signature.handle_ident.clone()))),
                  args,
                  type_args: None,
                }));
                self.signatures.push(signature);
              }
            }
            _ => {}
          };
          call.args[0] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Assign(AssignExpr {
              span: DUMMY_SP,
              op: AssignOp::Assign,
              left: PatOrExpr::Expr(Box::new(Expr::Ident(handle_ident))),
              right,
            })),
          }
        }
        _ => {}
      }
      return true;
    }
    false
  }

  fn create_arguments_for_signature(
    &self,
    bindings: &HashSet<String>,
    signature: &Signature,
  ) -> Vec<ExprOrSpread> {
    let mut key = Vec::<String>::new();
    let mut custom_hooks_in_scope = Vec::<(Option<Ident>, Ident)>::new();
    let mut args: Vec<ExprOrSpread> = vec![];
    match &signature.parent_ident {
      Some(parent_ident) => args.push(ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Ident(parent_ident.clone())),
      }),
      None => {}
    }
    let mut force_reset = false;
    // todo: parse @refresh reset command
    signature.hook_calls.clone().into_iter().for_each(|call| {
      key.push(call.key);
      if !call.is_builtin {
        match call.obj {
          Some(obj) => {
            if bindings.contains(obj.sym.as_ref().into()) {
              custom_hooks_in_scope.push((Some(obj.clone()), call.ident.clone()));
            } else {
              force_reset = true
            }
          }
          None => {
            if bindings.contains(call.ident.sym.as_ref().into()) {
              custom_hooks_in_scope.push((None, call.ident.clone()));
            } else {
              force_reset = true;
            }
          }
        }
      }
    });
    let mut key = key.join("\n");
    if !self.emit_full_signatures {
      let mut hasher = Sha1::new();
      hasher.update(key);
      key = BASE64.encode(&hasher.finalize());
    }
    args.push(ExprOrSpread {
      spread: None,
      expr: Box::new(Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: key.into(),
        has_escape: false,
        kind: Default::default(),
      }))),
    });
    if force_reset || custom_hooks_in_scope.len() > 0 {
      args.push(ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Lit(Lit::Bool(Bool {
          span: DUMMY_SP,
          value: force_reset,
        }))),
      });
    }
    if custom_hooks_in_scope.len() > 0 {
      args.push(ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Arrow(ArrowExpr {
          span: DUMMY_SP,
          params: vec![],
          body: BlockStmtOrExpr::Expr(Box::new(Expr::Array(ArrayLit {
            span: DUMMY_SP,
            elems: custom_hooks_in_scope
              .into_iter()
              .map(|hook| {
                let (obj, id) = hook;
                if let Some(obj) = obj {
                  Some(ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Member(MemberExpr {
                      span: DUMMY_SP,
                      obj: ExprOrSuper::Expr(Box::new(Expr::Ident(obj.clone()))),
                      prop: Box::new(Expr::Ident(id.clone())),
                      computed: false,
                    })),
                  })
                } else {
                  Some(ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Ident(id.clone())),
                  })
                }
              })
              .collect(),
          }))),
          is_async: false,
          is_generator: false,
          type_params: None,
          return_type: None,
        })),
      });
    }
    args
  }
}

impl Fold for ReactRefreshFold {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut raw_items = Vec::<ModuleItem>::new();
    let mut bindings = HashSet::<String>::new();

    // collect top bindings
    for item in module_items.clone() {
      match item {
        // import React, {useState} from "/react.js"
        ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl { specifiers, .. })) => {
          specifiers
            .into_iter()
            .for_each(|specifier| match specifier {
              ImportSpecifier::Named(ImportNamedSpecifier { local, .. })
              | ImportSpecifier::Default(ImportDefaultSpecifier { local, .. })
              | ImportSpecifier::Namespace(ImportStarAsSpecifier { local, .. }) => {
                bindings.insert(local.sym.as_ref().into());
              }
            });
        }

        // export function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Fn(FnDecl { ident, .. }),
          ..
        })) => {
          bindings.insert(ident.sym.as_ref().into());
        }

        // export default function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl: DefaultDecl::Fn(FnExpr {
            ident: Some(ident), ..
          }),
          ..
        })) => {
          bindings.insert(ident.sym.as_ref().into());
        }

        // function App() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl { ident, .. }))) => {
          bindings.insert(ident.sym.as_ref().into());
        }

        // const Foo = () => {}
        // export const App = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl { decls, .. })))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(VarDecl { decls, .. }),
          ..
        })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name: Pat::Ident(BindingIdent { id, .. }),
              ..
            } => {
              bindings.insert(id.sym.as_ref().into());
            }
            _ => {}
          });
        }

        _ => {}
      };
    }

    for mut item in module_items {
      let mut persistent_fns = Vec::<(Option<Ident>, Option<Signature>)>::new();
      let mut hocs = Vec::<(Ident, Ident)>::new();
      match &mut item {
        // export function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl:
            Decl::Fn(FnDecl {
              ident,
              function: Function {
                body: Some(body), ..
              },
              ..
            }),
          ..
        })) => persistent_fns.push(self.get_persistent_fn(&bindings, Some(ident), body)),

        // export default function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl:
            DefaultDecl::Fn(FnExpr {
              ident: Some(ident),
              function: Function {
                body: Some(body), ..
              },
              ..
            }),
          ..
        })) => persistent_fns.push(self.get_persistent_fn(&bindings, Some(ident), body)),

        // export default React.memo(() => {})
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(ExportDefaultExpr {
          expr, ..
        })) => match expr.as_mut() {
          Expr::Call(call) => {
            if self.find_inner_component(&bindings, "%default%", call) {
              let handle_ident = self.create_registration_handle_ident();
              self
                .registrations
                .push((handle_ident.clone(), "%default%".into()));
              // export default _c2 = React.memo(_c = () => {})
              item = ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(ExportDefaultExpr {
                span: DUMMY_SP,
                expr: Box::new(Expr::Assign(AssignExpr {
                  span: DUMMY_SP,
                  op: AssignOp::Assign,
                  left: PatOrExpr::Expr(Box::new(Expr::Ident(handle_ident))),
                  right: Box::new(Expr::Call(call.clone())),
                })),
              }));
            }
          }
          _ => {}
        },

        // function App() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
          ident,
          function: Function {
            body: Some(body), ..
          },
          ..
        }))) => persistent_fns.push(self.get_persistent_fn(&bindings, Some(ident), body)),

        // const Foo = () => {}
        // export const App = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl { decls, .. })))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(VarDecl { decls, .. }),
          ..
        })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name: Pat::Ident(BindingIdent { id, .. }),
              init: Some(init_expr),
              ..
            } => {
              match init_expr.as_mut() {
                // const Foo = function () {}
                Expr::Fn(FnExpr {
                  function: Function {
                    body: Some(body), ..
                  },
                  ..
                }) => persistent_fns.push(self.get_persistent_fn(&bindings, Some(id), body)),
                // const Foo = () => {}
                Expr::Arrow(ArrowExpr {
                  body: BlockStmtOrExpr::BlockStmt(body),
                  ..
                }) => persistent_fns.push(self.get_persistent_fn(&bindings, Some(id), body)),
                // const Bar = () => <div />
                Expr::Arrow(ArrowExpr {
                  body: BlockStmtOrExpr::Expr(expr),
                  ..
                }) => match expr.as_ref() {
                  Expr::JSXElement(jsx) => match jsx.as_ref() {
                    JSXElement { .. } => persistent_fns.push((Some(id.clone()), None)),
                  },
                  _ => {}
                },
                // const A = forwardRef(function() {});
                Expr::Call(call) => {
                  if self.find_inner_component(&bindings, id.sym.as_ref(), call) {
                    let handle_ident = self.create_registration_handle_ident();
                    self
                      .registrations
                      .push((handle_ident.clone(), id.sym.as_ref().into()));
                    hocs.push((id.clone(), handle_ident))
                  }
                }
                _ => {}
              }
            }
            _ => {}
          });
        }

        _ => {}
      };

      raw_items.push(item);

      for (fc_id, signature) in persistent_fns {
        if let Some(fc_id) = fc_id {
          let registration_handle_id = self.create_registration_handle_ident();
          self
            .registrations
            .push((registration_handle_id.clone(), fc_id.sym.as_ref().into()));

          // ! insert
          // _c = App;
          // _c2 = Foo;
          raw_items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Assign(AssignExpr {
              span: DUMMY_SP,
              op: AssignOp::Assign,
              left: PatOrExpr::Pat(Box::new(Pat::Ident(BindingIdent {
                id: registration_handle_id,
                type_ann: None,
              }))),
              right: Box::new(Expr::Ident(fc_id)),
            })),
          })));
        }

        if let Some(signature) = signature {
          self.signatures.push(signature);
        }
      }

      // ! insert (hoc)
      // _c = App;
      // _c2 = Foo;
      for (hoc_id, hoc_handle_id) in hocs {
        raw_items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
          span: DUMMY_SP,
          expr: Box::new(Expr::Assign(AssignExpr {
            span: DUMMY_SP,
            op: AssignOp::Assign,
            left: PatOrExpr::Pat(Box::new(Pat::Ident(BindingIdent {
              id: hoc_handle_id,
              type_ann: None,
            }))),
            right: Box::new(Expr::Ident(hoc_id)),
          })),
        })));
      }
    }

    // ! insert
    // var _c, _c2;
    if self.registrations.len() > 0 {
      items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
        span: DUMMY_SP,
        kind: VarDeclKind::Var,
        declare: false,
        decls: self
          .registrations
          .clone()
          .into_iter()
          .map(|registration| VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(BindingIdent {
              id: registration.0,
              type_ann: None,
            }),
            init: None,
            definite: false,
          })
          .collect(),
      }))));
    }

    // ! insert
    // var _s = $RefreshSig$(), _s2 = $RefreshSig$();
    if self.signatures.len() > 0 {
      items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
        span: DUMMY_SP,
        kind: VarDeclKind::Var,
        declare: false,
        decls: self
          .signatures
          .clone()
          .into_iter()
          .map(|signature| VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(BindingIdent {
              id: signature.handle_ident,
              type_ann: None,
            }),
            init: Some(Box::new(Expr::Call(CallExpr {
              span: DUMMY_SP,
              callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
                .refresh_sig
                .as_str())))),
              args: vec![],
              type_args: None,
            }))),
            definite: false,
          })
          .collect(),
      }))));
    }

    // ! insert raw items
    for item in raw_items {
      items.push(item);
    }

    // ! insert
    // _s(App, "useState{[count, setCount](0)}\nuseEffect{}");
    for signature in &self.signatures {
      match signature.parent_ident {
        Some(_) => {
          let args = self.create_arguments_for_signature(&bindings, &signature);
          items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Call(CallExpr {
              span: DUMMY_SP,
              callee: ExprOrSuper::Expr(Box::new(Expr::Ident(signature.handle_ident.clone()))),
              args,
              type_args: None,
            })),
          })));
        }
        None => {}
      }
    }

    // ! insert
    // $RefreshReg$(_c, "App");
    // $RefreshReg$(_c2, "Foo");
    for (registration_id, fc_name) in self.registrations.clone() {
      items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Call(CallExpr {
          span: DUMMY_SP,
          callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
            .refresh_reg
            .as_str())))),
          args: vec![
            ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::Ident(registration_id)),
            },
            ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: fc_name.into(),
                has_escape: false,
                kind: Default::default(),
              }))),
            },
          ],
          type_args: None,
        })),
      })));
    }
    items
  }
}

fn is_componentish_name(name: &str) -> bool {
  name.starts_with(char::is_uppercase)
}

fn is_builtin_hook(obj: Option<&Ident>, id: &str) -> bool {
  let ok = match id {
    "useState"
    | "useReducer"
    | "useEffect"
    | "useLayoutEffect"
    | "useMemo"
    | "useCallback"
    | "useRef"
    | "useContext"
    | "useImperativeHandle"
    | "useDebugValue" => true,
    _ => false,
  };
  match obj {
    Some(obj) => match obj.sym.as_ref() {
      "React" => ok,
      _ => false,
    },
    None => ok,
  }
}

fn get_call_callee(call: &CallExpr) -> Option<(Option<Ident>, Ident)> {
  let callee = match &call.callee {
    ExprOrSuper::Super(_) => return None,
    ExprOrSuper::Expr(callee) => callee.as_ref(),
  };

  match callee {
    // useState()
    Expr::Ident(id) => Some((None, id.clone())),
    // React.useState()
    Expr::Member(expr) => match &expr.obj {
      ExprOrSuper::Expr(obj) => match obj.as_ref() {
        Expr::Ident(obj) => match expr.prop.as_ref() {
          Expr::Ident(prop) => Some((Some(obj.clone()), prop.clone())),
          _ => None,
        },
        _ => None,
      },
      _ => None,
    },
    _ => None,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cmp::min;

  use swc_common::comments::SingleThreadedComments;
  use swc_common::{FileName, SourceMap, sync::Lrc, Globals};
  use swc_ecmascript::parser::lexer::Lexer;
  use swc_ecmascript::parser::{Parser, EsConfig, StringInput, Syntax, PResult};
  use swc_ecmascript::codegen::text_writer::JsWriter;
  use swc_ecmascript::visit::FoldWith;

  fn parse(code: &str) -> PResult<(Module, SingleThreadedComments, Lrc<SourceMap>)> {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(
      FileName::Anon,
      code.into()
    );
  
    let comments = SingleThreadedComments::default();  
    let mut esconfig = EsConfig::default();
    esconfig.dynamic_import = true;
    esconfig.jsx = true;
    let lexer = Lexer::new(
      Syntax::Es(esconfig),
      Default::default(),
      StringInput::from(&*source_file),
      Some(&comments),
    );
  
    let mut parser = Parser::new_from(lexer);
    match parser.parse_module() {
      Ok(module) => Ok((module, comments, source_map)),
      Err(err) => Err(err)
    }
  }

  fn emit(source_map: Lrc<SourceMap>, comments: SingleThreadedComments, program: &Module) -> String {
    let mut src_map_buf = vec![];
    let mut buf = vec![];
    {
      let writer = Box::new(
        JsWriter::new(
          source_map.clone(),
          "\n",
          &mut buf,
          Some(&mut src_map_buf),
        )
      );
      let config = swc_ecmascript::codegen::Config { minify: false };
      let mut emitter = swc_ecmascript::codegen::Emitter {
        cfg: config,
        comments: Some(&comments),
        cm: source_map.clone(),
        wr: writer,
      };
      
      emitter.emit_module(&program);
    }
  
    return String::from_utf8(buf).unwrap();
  }

  fn t(specifier: &str, source: &str, expect: &str) -> bool {
    let (module, comments, source_map) = parse(source).expect("could not parse module");
    let code = swc_common::GLOBALS.set(&Globals::new(), || {
      let module = module.fold_with(
        &mut react_refresh(
          "$RefreshReg$",
          "$RefreshSig$",
          true,
          source_map.clone(),
        )
      );

      emit(source_map, comments, &module)
    });

    if code != expect {
      let mut p: usize = 0;
      for i in 0..min(code.len(), expect.len()) {
        if code.get(i..i + 1) != expect.get(i..i + 1) {
          p = i;
          break;
        }
      }
      println!(
        "{}\x1b[0;31m{}\x1b[0m",
        code.get(0..p).unwrap(),
        code.get(p..).unwrap()
      );
    }
    code == expect
  }

  #[test]
  fn fast_refresh() {
    let source = r#"
    function Hello() {
      return <h1>Hi</h1>;
    }
    Hello = connect(Hello);
    const Bar = () => {
      return <Hello />;
    };
    var Baz = () => <div />;
    export default function App() {
      const [foo, setFoo] = useState(0);
      const bar = useState(() => 0);
      const [state, dispatch] = useReducer(reducer, initialState, init);
      React.useEffect(() => {}, []);
      return <h1>{foo}</h1>;
    }
    "#;
    let expect = r#"var _c, _c2, _c3, _c4;
var _s = $RefreshSig$();
function Hello() {
    return <h1 >Hi</h1>;
}
_c = Hello;
Hello = connect(Hello);
const Bar = ()=>{
    return <Hello />;
};
_c2 = Bar;
var Baz = ()=><div />
;
_c3 = Baz;
export default function App() {
    _s();
    const [foo, setFoo] = useState(0);
    const bar = useState(()=>0
    );
    const [state, dispatch] = useReducer(reducer, initialState, init);
    React.useEffect(()=>{
    }, []);
    return <h1 >{foo}</h1>;
};
_c4 = App;
_s(App, "useState{[foo, setFoo](0)}\nuseState{bar(() => 0)}\nuseReducer{[state, dispatch](initialState)}\nuseEffect{}");
$RefreshReg$(_c, "Hello");
$RefreshReg$(_c2, "Bar");
$RefreshReg$(_c3, "Baz");
$RefreshReg$(_c4, "App");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn fast_refresh_custom_hooks() {
    let source = r#"
    const useFancyEffect = () => {
      React.useEffect(() => { });
    };
    function useFancyState() {
      const [foo, setFoo] = React.useState(0);
      useFancyEffect();
      return foo;
    }
    function useFoo() {
      const [x] = useBar(1, 2, 3);
      useBarEffect();
    }
    export default function App() {
      const bar = useFancyState();
      return <h1>{bar}</h1>;
    }
    "#;
    let expect = r#"var _c;
var _s = $RefreshSig$(), _s2 = $RefreshSig$(), _s3 = $RefreshSig$(), _s4 = $RefreshSig$();
const useFancyEffect = ()=>{
    _s();
    React.useEffect(()=>{
    });
};
function useFancyState() {
    _s2();
    const [foo, setFoo] = React.useState(0);
    useFancyEffect();
    return foo;
}
function useFoo() {
    _s3();
    const [x] = useBar(1, 2, 3);
    useBarEffect();
}
export default function App() {
    _s4();
    const bar = useFancyState();
    return <h1 >{bar}</h1>;
};
_c = App;
_s(useFancyEffect, "useEffect{}");
_s2(useFancyState, "useState{[foo, setFoo](0)}\nuseFancyEffect{}", false, ()=>[
        useFancyEffect
    ]
);
_s3(useFoo, "useBar{[x]}\nuseBarEffect{}", true);
_s4(App, "useFancyState{bar}", false, ()=>[
        useFancyState
    ]
);
$RefreshReg$(_c, "App");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn fast_refresh_exotic_signature() {
    let source = r#"
    import FancyHook from 'fancy';
    export default function App() {
      const useFancyState = () => {
        const [foo, setFoo] = React.useState(0);
        useFancyEffect();
        return foo;
      }
      const bar = useFancyState();
      const baz = FancyHook.useThing();
      React.useState();
      useThePlatform();
      useFancyEffect();
      function useFancyEffect() {
        useEffect();
      }
      return <h1>{bar}{baz}</h1>;
    }
    "#;
    let expect = r#"var _c;
var _s3 = $RefreshSig$();
import FancyHook from 'fancy';
export default function App() {
    _s3();
    var _s = $RefreshSig$(), _s2 = $RefreshSig$();
    const useFancyState = ()=>{
        _s();
        const [foo, setFoo] = React.useState(0);
        useFancyEffect();
        return foo;
    };
    _s(useFancyState, "useState{[foo, setFoo](0)}\nuseFancyEffect{}", false, ()=>[
            useFancyEffect
        ]
    );
    const bar = useFancyState();
    const baz = FancyHook.useThing();
    React.useState();
    useThePlatform();
    useFancyEffect();
    function useFancyEffect() {
        _s2();
        useEffect();
    }
    _s2(useFancyEffect, "useEffect{}");
    return <h1 >{bar}{baz}</h1>;
};
_c = App;
_s3(App, "useFancyState{bar}\nuseThing{baz}\nuseState{}\nuseThePlatform{}\nuseFancyEffect{}", true, ()=>[
        FancyHook.useThing
    ]
);
$RefreshReg$(_c, "App");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn fast_refresh_hocs() {
    let source = r#"
    const A = forwardRef(function() {
      return <h1>Foo</h1>;
    });
    const B = memo(React.forwardRef(() => {
      return <h1>Foo</h1>;
    }));
    const C = forwardRef(memo(forwardRef(()=>null)))
    export const D = React.memo(React.forwardRef((props, ref) => {
      const [foo, setFoo] = useState(0);
      React.useEffect(() => {});
      return <h1 ref={ref}>{foo}</h1>;
    }));
    export const E = React.memo(React.forwardRef(function(props, ref) {
      const [foo, setFoo] = useState(0);
      React.useEffect(() => {});
      return <h1 ref={ref}>{foo}</h1>;
    }));
    function hoc() {
      return function Inner() {
        const [foo, setFoo] = useState(0);
        React.useEffect(() => {});
        return <h1 ref={ref}>{foo}</h1>;
      };
    }
    const F = memo('Foo');
    const G = forwardRef(memo(forwardRef()));
    const I = forwardRef(memo(forwardRef(0, () => {})));
    export let H = hoc();
    export default React.memo(forwardRef((props, ref) => {
      return <h1>Foo</h1>;
    }));
    "#;
    let expect = r#"var _c, _c2, _c3, _c4, _c5, _c6, _c7, _c8, _c9, _c10, _c11, _c12, _c13, _c14, _c15, _c16, _c17, _c18;
var _s = $RefreshSig$(), _s2 = $RefreshSig$();
const A = forwardRef(_c = function() {
    return <h1 >Foo</h1>;
});
_c2 = A;
const B = memo(_c4 = React.forwardRef(_c3 = ()=>{
    return <h1 >Foo</h1>;
}));
_c5 = B;
const C = forwardRef(_c8 = memo(_c7 = forwardRef(_c6 = ()=>null
)));
_c9 = C;
export const D = React.memo(_c11 = React.forwardRef(_c10 = _s((props, ref)=>{
    _s();
    const [foo, setFoo] = useState(0);
    React.useEffect(()=>{
    });
    return <h1 ref={ref}>{foo}</h1>;
}, "useState{[foo, setFoo](0)}\nuseEffect{}")));
_c12 = D;
export const E = React.memo(_c14 = React.forwardRef(_c13 = _s2(function(props, ref) {
    _s2();
    const [foo, setFoo] = useState(0);
    React.useEffect(()=>{
    });
    return <h1 ref={ref}>{foo}</h1>;
}, "useState{[foo, setFoo](0)}\nuseEffect{}")));
_c15 = E;
function hoc() {
    var _s3 = $RefreshSig$();
    return _s3(function Inner() {
        _s3();
        const [foo, setFoo] = useState(0);
        React.useEffect(()=>{
        });
        return <h1 ref={ref}>{foo}</h1>;
    }, "useState{[foo, setFoo](0)}\nuseEffect{}");
}
const F = memo('Foo');
const G = forwardRef(memo(forwardRef()));
const I = forwardRef(memo(forwardRef(0, ()=>{
})));
export let H = hoc();
export default _c18 = React.memo(_c17 = forwardRef(_c16 = (props, ref)=>{
    return <h1 >Foo</h1>;
}));
$RefreshReg$(_c, "A$forwardRef");
$RefreshReg$(_c2, "A");
$RefreshReg$(_c3, "B$memo$React.forwardRef");
$RefreshReg$(_c4, "B$memo");
$RefreshReg$(_c5, "B");
$RefreshReg$(_c6, "C$forwardRef$memo$forwardRef");
$RefreshReg$(_c7, "C$forwardRef$memo");
$RefreshReg$(_c8, "C$forwardRef");
$RefreshReg$(_c9, "C");
$RefreshReg$(_c10, "D$React.memo$React.forwardRef");
$RefreshReg$(_c11, "D$React.memo");
$RefreshReg$(_c12, "D");
$RefreshReg$(_c13, "E$React.memo$React.forwardRef");
$RefreshReg$(_c14, "E$React.memo");
$RefreshReg$(_c15, "E");
$RefreshReg$(_c16, "%default%$React.memo$forwardRef");
$RefreshReg$(_c17, "%default%$React.memo");
$RefreshReg$(_c18, "%default%");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn fast_refresh_ignored() {
    let source = r#"
    const NotAComp = 'hi';
    export { Baz, NotAComp };
    export function sum() {}
    export const Bad = 42;
    let connect = () => {
      function Comp() {
        const handleClick = () => {};
        return <h1 onClick={handleClick}>Hi</h1>;
      }
      return Comp;
    };
    function withRouter() {
      return function Child() {
        const handleClick = () => {};
        return <h1 onClick={handleClick}>Hi</h1>;
      }
    };
    let A = foo ? () => {
      return <h1>Hi</h1>;
    } : null;
    const B = (function Foo() {
      return <h1>Hi</h1>;
    })();
    let C = () => () => {
      return <h1>Hi</h1>;
    };
    let D = bar && (() => {
      return <h1>Hi</h1>;
    });
    const throttledAlert = throttle(function () {
      alert('Hi');
    });
    const TooComplex = function () {
      return hello;
    }(() => {});
    if (cond) {
      const Foo = thing(() => {});
    }
    export default function() {}
    "#;
    let expect = r#"const NotAComp = 'hi';
export { Baz, NotAComp };
export function sum() {
}
export const Bad = 42;
let connect = ()=>{
    function Comp() {
        const handleClick = ()=>{
        };
        return <h1 onClick={handleClick}>Hi</h1>;
    }
    return Comp;
};
function withRouter() {
    return function Child() {
        const handleClick = ()=>{
        };
        return <h1 onClick={handleClick}>Hi</h1>;
    };
}
;
let A = foo ? ()=>{
    return <h1 >Hi</h1>;
} : null;
const B = (function Foo() {
    return <h1 >Hi</h1>;
})();
let C = ()=>()=>{
        return <h1 >Hi</h1>;
    }
;
let D = bar && (()=>{
    return <h1 >Hi</h1>;
});
const throttledAlert = throttle(function() {
    alert('Hi');
});
const TooComplex = function() {
    return hello;
}(()=>{
});
if (cond) {
    const Foo = thing(()=>{
    });
}
export default function() {
};
"#;
    assert!(t("/app.jsx", source, expect));
  }
}
