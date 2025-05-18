use rustc_hash::FxHashSet;
use swc_core::common::util::take::Take;
use swc_core::common::{DUMMY_SP, Mark, Span, SyntaxContext};
use swc_core::ecma::ast::*;
use swc_core::ecma::utils::collect_decls;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

use crate::utils::is_unresolved;

pub struct ReactServer {
  global_mark: Mark,
  unresolved_mark: Mark,
  unique_key: String,
  server_functions: Vec<FnDecl>,
  decrypt_ident: Option<Ident>,
  encrypt_ident: Option<Ident>,
  references: FxHashSet<Id>,
}

impl ReactServer {
  pub fn new(global_mark: Mark, unresolved_mark: Mark, unique_key: String) -> Self {
    ReactServer {
      global_mark,
      unresolved_mark,
      unique_key,
      server_functions: Vec::new(),
      decrypt_ident: None,
      encrypt_ident: None,
      references: FxHashSet::default(),
    }
  }

  fn add_server_function(
    &mut self,
    mut params: Vec<Param>,
    mut body: BlockStmt,
    span: Span,
    ctxt: SyntaxContext,
  ) -> Expr {
    let fn_id = Ident::new_private("a".into(), DUMMY_SP);
    let res = if let Some((ident, arr)) = ServerFunctionVisitor::visit_server_function(
      &mut body,
      self.global_mark,
      self.unresolved_mark,
      &mut self.decrypt_ident,
      &mut self.references,
    ) {
      params.insert(
        0,
        Param {
          pat: Pat::Ident(BindingIdent {
            id: ident,
            type_ann: None,
          }),
          decorators: Vec::new(),
          span: DUMMY_SP,
        },
      );

      let encrypt_ident = if let Some(encrypt_ident) = &self.encrypt_ident {
        encrypt_ident.clone()
      } else {
        self.encrypt_ident = Some(Ident::new_private("encryptClosure".into(), DUMMY_SP));
        self.encrypt_ident.clone().unwrap()
      };

      Expr::Call(CallExpr {
        span: DUMMY_SP,
        ctxt: fn_id.ctxt,
        callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
          span: DUMMY_SP,
          obj: Box::new(Expr::Ident(fn_id.clone())),
          prop: MemberProp::Ident(IdentName::new("bind".into(), DUMMY_SP)),
        }))),
        args: vec![
          ExprOrSpread {
            expr: Box::new(Expr::Lit(Lit::Null(Null { span: DUMMY_SP }))),
            spread: None,
          },
          ExprOrSpread {
            expr: Box::new(Expr::Call(CallExpr {
              callee: Callee::Expr(Box::new(Expr::Ident(encrypt_ident))),
              args: vec![ExprOrSpread {
                expr: Box::new(Expr::Array(arr)),
                spread: None,
              }],
              ..Default::default()
            })),
            spread: None,
          },
        ],
        type_args: None,
      })
    } else {
      Expr::Ident(fn_id.clone())
    };

    self.server_functions.push(FnDecl {
      ident: fn_id,
      declare: false,
      function: Box::new(Function {
        params,
        decorators: Vec::new(),
        span,
        ctxt,
        body: Some(body),
        is_generator: false,
        is_async: true,
        type_params: None,
        return_type: None,
      }),
    });

    res
  }

  pub fn into_module(mut self) -> Option<Module> {
    let has_server_functions = !self.server_functions.is_empty();
    if !has_server_functions {
      return None;
    }

    let mut body = vec![ModuleItem::Stmt(Stmt::Expr(ExprStmt {
      span: DUMMY_SP,
      expr: Box::new(Expr::Lit("use server".into())),
    }))];

    if self.decrypt_ident.is_some() {
      let mut specifiers = Vec::new();
      if let Some(decrypt_ident) = &self.decrypt_ident {
        specifiers.push(ImportSpecifier::Named(ImportNamedSpecifier {
          span: DUMMY_SP,
          local: decrypt_ident.clone(),
          imported: None,
          is_type_only: false,
        }));
      }

      body.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        span: DUMMY_SP,
        specifiers,
        src: Box::new("@parcel/transformer-js/src/rsc-utils.js".into()),
        type_only: false,
        with: None,
        phase: Default::default(),
      })));
    }

    if !self.references.is_empty() {
      body.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        span: DUMMY_SP,
        src: Box::new(self.unique_key.as_str().into()),
        specifiers: self
          .references
          .drain()
          .map(|(name, ctxt)| {
            ImportSpecifier::Named(ImportNamedSpecifier {
              span: DUMMY_SP,
              local: Ident::new(name, DUMMY_SP, ctxt),
              imported: None,
              is_type_only: false,
            })
          })
          .collect(),
        type_only: false,
        with: None,
        phase: Default::default(),
      })));
    }

    body.extend(self.server_functions.drain(..).map(|f| {
      ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
        span: DUMMY_SP,
        decl: Decl::Fn(f),
      }))
    }));

    Some(Module {
      span: DUMMY_SP,
      body,
      shebang: None,
    })
  }
}

fn is_server_function(body: &BlockStmt) -> bool {
  for item in &body.stmts {
    if let Stmt::Expr(ExprStmt { expr, .. }) = item {
      if matches!(&**expr, Expr::Lit(Lit::Str(Str { value, .. })) if value == "use server") {
        return true;
      }
    }
    break;
  }

  false
}

impl VisitMut for ReactServer {
  fn visit_mut_decl(&mut self, node: &mut Decl) {
    match node {
      Decl::Fn(f) => {
        if let Some(body) = &mut f.function.body {
          if is_server_function(body) {
            if !f.function.is_async {
              // TODO: error
            }

            if f.function.is_generator {
              // TODO: error
            }

            let expr = self.add_server_function(
              f.function.params.take(),
              body.take(),
              f.function.span,
              f.function.ctxt,
            );

            *node = Decl::Var(Box::new(VarDecl {
              span: DUMMY_SP,
              ctxt: f.function.ctxt,
              kind: VarDeclKind::Var,
              declare: false,
              decls: vec![VarDeclarator {
                span: DUMMY_SP,
                name: Pat::Ident(BindingIdent {
                  id: f.ident.take(),
                  type_ann: None,
                }),
                init: Some(Box::new(expr)),
                definite: false,
              }],
            }))
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_expr(&mut self, node: &mut Expr) {
    match node {
      Expr::Arrow(f) => {
        if let BlockStmtOrExpr::BlockStmt(body) = &mut *f.body {
          if is_server_function(body) {
            if !f.is_async {
              // TODO: error
            }

            if f.is_generator {
              // TODO: error
            }

            let body = body.take();
            let params: Vec<Param> = f
              .params
              .take()
              .into_iter()
              .map(|pat| Param {
                pat,
                decorators: Vec::new(),
                span: DUMMY_SP,
              })
              .collect();

            *node = self.add_server_function(params, body, f.span, f.ctxt);
          }
        }
      }
      Expr::Fn(f) => {
        if let Some(body) = &mut f.function.body {
          if is_server_function(body) {
            if !f.function.is_async {
              // TODO: error
            }

            if f.function.is_generator {
              // TODO: error
            }

            *node = self.add_server_function(
              f.function.params.take(),
              body.take(),
              f.function.span,
              f.function.ctxt,
            );
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_prop(&mut self, node: &mut Prop) {
    match node {
      Prop::Method(f) => {
        if let Some(body) = &f.function.body {
          if is_server_function(body) {}
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_class_member(&mut self, node: &mut ClassMember) {
    match node {
      ClassMember::Method(f) => {
        if let Some(body) = &mut f.function.body {
          if is_server_function(body) {
            if !f.is_static {
              // TODO: error
            }

            if !f.function.is_async {
              // TODO: error
            }

            if f.function.is_generator {
              // TODO: error
            }

            // TODO
          }
        }
      }
      ClassMember::PrivateMethod(f) => {
        if let Some(body) = &mut f.function.body {
          if is_server_function(body) {
            if !f.is_static {
              // TODO: error
            }

            if !f.function.is_async {
              // TODO: error
            }

            if f.function.is_generator {
              // TODO: error
            }

            // TODO
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_module(&mut self, node: &mut Module) {
    node.visit_mut_children_with(self);

    if !self.server_functions.is_empty() {
      node
        .body
        .push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
          span: DUMMY_SP,
          specifiers: self
            .server_functions
            .iter()
            .map(|f| {
              ImportSpecifier::Named(ImportNamedSpecifier {
                span: DUMMY_SP,
                local: f.ident.clone(),
                imported: None,
                is_type_only: false,
              })
            })
            .collect(),
          src: Box::new("parcel-server-actions".into()),
          type_only: false,
          with: None,
          phase: Default::default(),
        })))
    }

    if !self.references.is_empty() {
      node
        .body
        .push(ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(
          NamedExport {
            span: DUMMY_SP,
            specifiers: self
              .references
              .iter()
              .map(|(id, ctxt)| {
                ExportSpecifier::Named(ExportNamedSpecifier {
                  span: DUMMY_SP,
                  orig: ModuleExportName::Ident(Ident::new(id.clone(), DUMMY_SP, *ctxt)),
                  exported: None,
                  is_type_only: false,
                })
              })
              .collect(),
            src: None,
            type_only: false,
            with: None,
          },
        )))
    }

    if self.encrypt_ident.is_some() {
      let mut specifiers = Vec::new();
      if let Some(encrypt_ident) = &self.encrypt_ident {
        specifiers.push(ImportSpecifier::Named(ImportNamedSpecifier {
          span: DUMMY_SP,
          local: encrypt_ident.clone(),
          imported: None,
          is_type_only: false,
        }));
      }

      node
        .body
        .push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
          span: DUMMY_SP,
          specifiers,
          src: Box::new("@parcel/transformer-js/src/rsc-utils.js".into()),
          type_only: false,
          with: None,
          phase: Default::default(),
        })));
    }
  }
}

struct ServerFunctionVisitor<'a> {
  global_mark: Mark,
  unresolved_mark: Mark,
  decls: FxHashSet<Id>,
  bound: Vec<(Ident, Expr)>,
  references: &'a mut FxHashSet<Id>,
}

impl<'a> ServerFunctionVisitor<'a> {
  fn visit_server_function(
    body: &mut BlockStmt,
    global_mark: Mark,
    unresolved_mark: Mark,
    decrypt_ident: &mut Option<Ident>,
    references: &mut FxHashSet<Id>,
  ) -> Option<(Ident, ArrayLit)> {
    let decls: FxHashSet<Id> = collect_decls(body);
    let mut visitor = ServerFunctionVisitor {
      global_mark,
      unresolved_mark,
      decls,
      bound: Vec::new(),
      references,
    };

    body.visit_mut_with(&mut visitor);

    if !visitor.bound.is_empty() {
      let closure_ident = Ident::new_private("closure".into(), DUMMY_SP);
      let (idents, exprs): (Vec<_>, Vec<_>) = visitor
        .bound
        .into_iter()
        .map(|(id, expr)| {
          (
            Some(Pat::Ident(BindingIdent { id, type_ann: None })),
            Some(ExprOrSpread {
              expr: Box::new(expr),
              spread: None,
            }),
          )
        })
        .unzip();

      let decrypt_ident = if let Some(decrypt_ident) = &decrypt_ident {
        decrypt_ident.clone()
      } else {
        *decrypt_ident = Some(Ident::new_private("decryptClosure".into(), DUMMY_SP));
        decrypt_ident.clone().unwrap()
      };

      body.stmts.insert(
        0,
        Stmt::Decl(Decl::Var(Box::new(VarDecl {
          decls: vec![VarDeclarator {
            name: Pat::Array(ArrayPat {
              span: DUMMY_SP,
              elems: idents,
              optional: false,
              type_ann: None,
            }),
            definite: false,
            init: Some(Box::new(Expr::Await(AwaitExpr {
              arg: Box::new(Expr::Call(CallExpr {
                callee: Callee::Expr(Box::new(Expr::Ident(decrypt_ident))),
                args: vec![ExprOrSpread {
                  expr: Box::new(Expr::Ident(closure_ident.clone())),
                  spread: None,
                }],
                ..Default::default()
              })),
              span: DUMMY_SP,
            }))),
            span: DUMMY_SP,
          }],
          ..Default::default()
        }))),
      );

      let arr = ArrayLit {
        span: DUMMY_SP,
        elems: exprs,
      };

      Some((closure_ident, arr))
    } else {
      None
    }
  }

  fn is_external_id(&mut self, id: &Ident) -> bool {
    if id.ctxt.has_mark(self.global_mark) {
      self.references.insert(id.to_id());
      return false;
    }

    !self.decls.contains(&id.to_id()) && !is_unresolved(id, self.unresolved_mark)
  }

  fn is_external_member(&mut self, member: &MemberExpr) -> bool {
    if !matches!(member.prop, MemberProp::Ident(_)) {
      return false;
    }

    match &*member.obj {
      Expr::Ident(id) => self.is_external_id(id),
      Expr::Member(member) => self.is_external_member(member),
      _ => false,
    }
  }
}

impl<'a> VisitMut for ServerFunctionVisitor<'a> {
  fn visit_mut_expr(&mut self, node: &mut Expr) {
    match node {
      Expr::Ident(id) if self.is_external_id(id) => {
        self.bound.push((id.clone(), Expr::Ident(id.clone())));
        return;
      }
      Expr::Member(member) if self.is_external_member(member) => {
        let id = Ident::new_private("bound".into(), DUMMY_SP);
        self.bound.push((id.clone(), node.clone()));
        *node = Expr::Ident(id);
        return;
      }
      Expr::OptChain(chain) => {
        if let OptChainBase::Member(member) = &*chain.base {
          if self.is_external_member(member) {
            let id = Ident::new_private("bound".into(), DUMMY_SP);
            self.bound.push((id.clone(), node.clone()));
            *node = Expr::Ident(id);
            return;
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_this_expr(&mut self, node: &mut ThisExpr) {
    // TODO: error
  }

  fn visit_mut_super_prop(&mut self, node: &mut SuperProp) {
    // TODO: error
  }
}

#[cfg(test)]
mod test {
  use swc_core::ecma::visit::VisitWith;
  use swc_core::{common::Mark, ecma::ast::Module};

  use super::*;
  use crate::test_utils::{RunTestContext, run_with_transformation};

  fn run(context: RunTestContext, module: &mut Module) {
    module.visit_mut_with(&mut ReactServer::new(
      context.global_mark,
      context.unresolved_mark,
      "foo".into(),
    ));
  }

  // #[test]
  fn test_arrow() {
    let code = r#"
    function ServerComponent() {
      let action = () => {
        "use server";
        console.log('hello');
      };
    }
    "#;

    let res = run_with_transformation(code, run);
    println!("{}", res.0);

    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  let action = () => {
    "use server";
    console.log(foo, bar.baz, doSomething(bar).a, moduleVar);
  };
}
    "#;

    let res = run_with_transformation(code, run);
    println!("{}", res.0);

    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  let action = () => {
    "use server";
    console.log(foo, bar.baz, doSomething(bar).a, moduleVar);

    let hi = 3;
    let nested = () => {
      "use server";
      console.log(foo, hi);
    };
  };
}
    "#;

    let res = run_with_transformation(code, run);
    println!("{}", res.0);
  }

  #[test]
  fn test_fn_decl() {
    let code = r#"
    function ServerComponent() {
      function action() {
        "use server";
        console.log('hello');
      }
    }
    "#;

    let res = run_with_transformation(code, run);
    println!("{}", res.0);

    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  function action() {
    "use server";
    console.log(foo, bar.baz, doSomething(bar).a, moduleVar);
  }
}
    "#;

    let res = run_with_transformation(code, run);
    println!("{}", res.0);
  }
}
