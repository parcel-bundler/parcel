use rustc_hash::{FxHashMap, FxHashSet};
use swc_core::common::util::take::Take;
use swc_core::common::{DUMMY_SP, Mark, SourceMap, Span, Spanned, SyntaxContext};
use swc_core::ecma::ast::*;
use swc_core::ecma::utils::collect_decls;
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

use crate::SourceLocation;
use crate::utils::{CodeHighlight, Diagnostic, is_unresolved};

pub struct ReactServer {
  global_mark: Mark,
  unresolved_mark: Mark,
  unique_key: String,
  server_functions: Vec<FnDecl>,
  decrypt_ident: Option<Ident>,
  encrypt_ident: Option<Ident>,
  references: FxHashMap<Id, Ident>,
  errors: Vec<ServerFunctionError>,
}

enum ServerFunctionError {
  NotAsync(Span),
  Generator(Span),
  ThisUsage(Span),
  SuperUsage(Span),
  ArgumentsUsage(Span),
  NotStatic(Span),
  HasDecorators(Span),
}

impl ServerFunctionError {
  fn into_diagnostic(self, source_map: &SourceMap) -> Diagnostic {
    let (message, span) = match self {
      ServerFunctionError::NotAsync(span) => ("React Server Functions must be async", span),
      ServerFunctionError::Generator(span) => ("React Server Functions cannot be generators", span),
      ServerFunctionError::ThisUsage(span) => {
        ("`this` is not allowed in React Server Functions", span)
      }
      ServerFunctionError::SuperUsage(span) => {
        ("`super` is not allowed in React Server Functions", span)
      }
      ServerFunctionError::ArgumentsUsage(span) => {
        ("`arguments` is not allowed in React Server Functions", span)
      }
      ServerFunctionError::NotStatic(span) => {
        ("React Server Functions cannot be instance methods", span)
      }
      ServerFunctionError::HasDecorators(span) => {
        ("React Server Functions cannot have decorators", span)
      }
    };

    Diagnostic {
      message: message.into(),
      code_highlights: Some(vec![CodeHighlight {
        loc: SourceLocation::from(source_map, span),
        message: None,
      }]),
      show_environment: false,
      severity: crate::utils::DiagnosticSeverity::Error,
      hints: None,
      documentation_url: None,
    }
  }
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
      references: FxHashMap::default(),
      errors: Vec::new(),
    }
  }

  fn add_server_function(
    &mut self,
    mut params: Vec<Param>,
    mut body: BlockStmt,
    span: Span,
    ctxt: SyntaxContext,
  ) -> Expr {
    let fn_id = Ident::new_private(format!("a{}", self.server_functions.len()).into(), DUMMY_SP);
    let res = if let Some((ident, arr)) = ServerFunctionVisitor::visit_server_function(
      &params,
      &mut body,
      self.global_mark,
      self.unresolved_mark,
      &mut self.decrypt_ident,
      &mut self.references,
      &mut self.errors,
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

  fn is_valid_function(
    &mut self,
    is_async: bool,
    is_generator: bool,
    has_decorators: bool,
    span: Span,
  ) -> bool {
    if !is_async {
      self.errors.push(ServerFunctionError::NotAsync(span));
      return false;
    }

    if is_generator {
      self.errors.push(ServerFunctionError::Generator(span));
      return false;
    }

    if has_decorators {
      self.errors.push(ServerFunctionError::HasDecorators(span));
      return false;
    }

    return true;
  }

  pub fn into_module(mut self, source_map: &SourceMap) -> Result<Option<Module>, Vec<Diagnostic>> {
    if !self.errors.is_empty() {
      return Err(
        self
          .errors
          .drain(..)
          .map(|e| e.into_diagnostic(source_map))
          .collect(),
      );
    }

    let has_server_functions = !self.server_functions.is_empty();
    if !has_server_functions {
      return Ok(None);
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
      let mut specifiers: Vec<_> = self
        .references
        .drain()
        .map(|((name, ctxt), imported)| {
          ImportSpecifier::Named(ImportNamedSpecifier {
            span: DUMMY_SP,
            local: Ident::new(name, DUMMY_SP, ctxt),
            imported: Some(ModuleExportName::Ident(imported)),
            is_type_only: false,
          })
        })
        .collect();

      specifiers.sort_by_cached_key(|s| s.local().sym.clone());

      body.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        span: DUMMY_SP,
        src: Box::new(self.unique_key.as_str().into()),
        specifiers,
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

    Ok(Some(Module {
      span: DUMMY_SP,
      body,
      shebang: None,
    }))
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
            if !self.is_valid_function(
              f.function.is_async,
              f.function.is_generator,
              !f.function.decorators.is_empty(),
              f.function.span,
            ) {
              return;
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
            if !self.is_valid_function(f.is_async, f.is_generator, false, f.span) {
              return;
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
            if !self.is_valid_function(
              f.function.is_async,
              f.function.is_generator,
              !f.function.decorators.is_empty(),
              f.function.span,
            ) {
              return;
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
      Prop::Method(m) => {
        if let Some(body) = &mut m.function.body {
          if is_server_function(body) {
            if !self.is_valid_function(
              m.function.is_async,
              m.function.is_generator,
              !m.function.decorators.is_empty(),
              m.function.span,
            ) {
              return;
            }

            let f = self.add_server_function(
              m.function.params.take(),
              body.take(),
              m.function.span,
              m.function.ctxt,
            );

            *node = Prop::KeyValue(KeyValueProp {
              key: m.key.take(),
              value: Box::new(f),
            });
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_class_member(&mut self, node: &mut ClassMember) {
    match node {
      ClassMember::Method(m) => {
        if let Some(body) = &mut m.function.body {
          if is_server_function(body) {
            if !m.is_static {
              self.errors.push(ServerFunctionError::NotStatic(m.span));
              return;
            }

            if !self.is_valid_function(
              m.function.is_async,
              m.function.is_generator,
              !m.function.decorators.is_empty(),
              m.function.span,
            ) {
              return;
            }

            let f = self.add_server_function(
              m.function.params.take(),
              body.take(),
              m.function.span,
              m.function.ctxt,
            );

            *node = ClassMember::ClassProp(ClassProp {
              span: m.span,
              key: m.key.take(),
              value: Some(Box::new(f)),
              type_ann: None,
              is_static: true,
              decorators: Vec::new(),
              accessibility: m.accessibility.take(),
              is_abstract: m.is_abstract,
              is_optional: m.is_optional,
              is_override: m.is_override,
              readonly: false,
              declare: false,
              definite: false,
            });
          }
        }
      }
      ClassMember::PrivateMethod(m) => {
        if let Some(body) = &mut m.function.body {
          if is_server_function(body) {
            if !m.is_static {
              self.errors.push(ServerFunctionError::NotStatic(m.span));
              return;
            }

            if !self.is_valid_function(
              m.function.is_async,
              m.function.is_generator,
              !m.function.decorators.is_empty(),
              m.function.span,
            ) {
              return;
            }

            let f = self.add_server_function(
              m.function.params.take(),
              body.take(),
              m.function.span,
              m.function.ctxt,
            );

            *node = ClassMember::PrivateProp(PrivateProp {
              span: m.span,
              key: m.key.clone(),
              value: Some(Box::new(f)),
              type_ann: None,
              is_static: true,
              decorators: Vec::new(),
              accessibility: m.accessibility.take(),
              is_optional: m.is_optional,
              is_override: m.is_override,
              readonly: false,
              definite: false,
              ctxt: m.function.ctxt,
            });
          }
        }
      }
      _ => {}
    }

    node.visit_mut_children_with(self);
  }

  fn visit_mut_module(&mut self, node: &mut Module) {
    // First check if the whole file already has a "use server" directive.
    // If so, then we don't need to proceed any further.
    for item in &node.body {
      if let ModuleItem::Stmt(Stmt::Expr(ExprStmt { expr, .. })) = item {
        if matches!(&**expr, Expr::Lit(Lit::Str(Str { value, .. })) if value == "use server") {
          return;
        }
      }
    }

    node.visit_mut_children_with(self);

    // Insert import statement for extracted server actions module.
    if !self.server_functions.is_empty() {
      node.body.insert(
        0,
        ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
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
          src: Box::new("parcel:server-actions".into()),
          type_only: false,
          with: None,
          phase: Default::default(),
        })),
      )
    }

    if !self.references.is_empty() {
      let mut specifiers: Vec<_> = self
        .references
        .iter()
        .map(|((id, ctxt), exported)| {
          ExportSpecifier::Named(ExportNamedSpecifier {
            span: DUMMY_SP,
            orig: ModuleExportName::Ident(Ident::new(id.clone(), DUMMY_SP, *ctxt)),
            exported: Some(ModuleExportName::Ident(exported.clone())),
            is_type_only: false,
          })
        })
        .collect();

      specifiers.sort_by_cached_key(|s| s.as_named().unwrap().orig.atom().clone());

      node
        .body
        .push(ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(
          NamedExport {
            span: DUMMY_SP,
            specifiers,
            src: None,
            type_only: false,
            with: None,
          },
        )))
    }

    // Import encryption helper
    if let Some(encrypt_ident) = &self.encrypt_ident {
      node.body.insert(
        0,
        ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
          span: DUMMY_SP,
          specifiers: vec![ImportSpecifier::Named(ImportNamedSpecifier {
            span: DUMMY_SP,
            local: encrypt_ident.clone(),
            imported: None,
            is_type_only: false,
          })],
          src: Box::new("@parcel/transformer-js/src/rsc-utils.js".into()),
          type_only: false,
          with: None,
          phase: Default::default(),
        })),
      );
    }
  }
}

struct ServerFunctionVisitor<'a> {
  global_mark: Mark,
  unresolved_mark: Mark,
  decls: FxHashSet<Id>,
  bound: Vec<(Ident, Expr)>,
  references: &'a mut FxHashMap<Id, Ident>,
  errors: &'a mut Vec<ServerFunctionError>,
}

impl<'a> ServerFunctionVisitor<'a> {
  fn visit_server_function(
    params: &Vec<Param>,
    body: &mut BlockStmt,
    global_mark: Mark,
    unresolved_mark: Mark,
    decrypt_ident: &mut Option<Ident>,
    references: &mut FxHashMap<Id, Ident>,
    errors: &mut Vec<ServerFunctionError>,
  ) -> Option<(Ident, ArrayLit)> {
    let mut decls: FxHashSet<Id> = collect_decls(body);
    decls.extend(collect_decls(params));
    let mut visitor = ServerFunctionVisitor {
      global_mark,
      unresolved_mark,
      decls,
      bound: Vec::new(),
      references,
      errors,
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

      // var [a, b, c] = await decryptClosure(closure);
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
    // Track access to module-level variables.
    // These will be exported from the main module and imported in the server actions module.
    if id.ctxt.has_mark(self.global_mark) {
      let len = self.references.len();
      self
        .references
        .entry(id.to_id())
        .or_insert_with(|| Ident::new_no_ctxt(format!("__actionShared{}", len).into(), DUMMY_SP));
      return false;
    }

    if is_unresolved(id, self.unresolved_mark) {
      if id.sym == "arguments" {
        self
          .errors
          .push(ServerFunctionError::ArgumentsUsage(id.span));
      }
      return false;
    }

    !self.decls.contains(&id.to_id())
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
    self.errors.push(ServerFunctionError::ThisUsage(node.span))
  }

  fn visit_mut_super_prop(&mut self, node: &mut SuperProp) {
    self
      .errors
      .push(ServerFunctionError::SuperUsage(node.span()))
  }
}

#[cfg(test)]
mod test {
  use indoc::indoc;
  use pretty_assertions::assert_eq;
  use swc_core::ecma::ast::Module;

  use super::*;
  use crate::test_utils::{RunTestContext, run_with_transformation};

  fn run(context: RunTestContext, module: &mut Module) -> Vec<Diagnostic> {
    let mut rsc = ReactServer::new(context.global_mark, context.unresolved_mark, "foo".into());
    module.visit_mut_with(&mut rsc);

    match rsc.into_module(&context.source_map) {
      Ok(Some(m)) => {
        module.body.extend(m.body);
      }
      Ok(None) => {}
      Err(diagnostics) => return diagnostics,
    }

    Vec::new()
  }

  #[test]
  fn test_arrow() {
    let code = r#"
    function ServerComponent() {
      let action = async () => {
        "use server";
        console.log('hello');
      };

      let action2 = async () => {
        "use server";
        console.log('yo');
      };
    }
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { a0, a1 } from "parcel:server-actions";
      function ServerComponent() {
          let action = a0;
          let action2 = a1;
      }
      "use server";
      export async function a0() {
          "use server";
          console.log('hello');
      }
      export async function a1() {
          "use server";
          console.log('yo');
      }
      "#}
    );

    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  let action = async (arg) => {
    "use server";
    let test = 3;
    console.log(foo, bar.baz, bar.baz.foo, doSomething(bar).a, moduleVar, test, arg);
  };
}
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { encryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { a0 } from "parcel:server-actions";
      let moduleVar = 2;
      function ServerComponent({ foo, bar }) {
          let action = a0.bind(null, encryptClosure([
              foo,
              bar.baz,
              bar.baz.foo,
              bar
          ]));
      }
      export { moduleVar as __actionShared0 };
      "use server";
      import { decryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { __actionShared0 as moduleVar } from "foo";
      export async function a0(closure, arg) {
          var [foo, bound, bound1, bar] = await decryptClosure(closure);
          "use server";
          let test = 3;
          console.log(foo, bound, bound1, doSomething(bar).a, moduleVar, test, arg);
      }
      "#}
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let action = () => {
        "use server";
        console.log('hello');
      };
    }
    "#,
      run,
    );
    assert_eq!(res.1[0].message, "React Server Functions must be async");

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let action = async () => {
        "use server";
        console.log(this);
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`this` is not allowed in React Server Functions"
    );
  }

  #[test]
  fn test_fn_expr() {
    let code = r#"
    function ServerComponent() {
      let action = async function () {
        "use server";
        console.log('hello');
      };
    }
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { a0 } from "parcel:server-actions";
      function ServerComponent() {
          let action = a0;
      }
      "use server";
      export async function a0() {
          "use server";
          console.log('hello');
      }
      "#}
    );

    let code = r#"
let moduleVar = 2;
let test2 = 4;
function ServerComponent({foo, bar}) {
  let action = async function (arg) {
    "use server";
    console.log(foo, bar.baz, doSomething(bar).a, moduleVar, test2, arg);
  };
}
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { encryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { a0 } from "parcel:server-actions";
      let moduleVar = 2;
      let test2 = 4;
      function ServerComponent({ foo, bar }) {
          let action = a0.bind(null, encryptClosure([
              foo,
              bar.baz,
              bar
          ]));
      }
      export { moduleVar as __actionShared0, test2 as __actionShared1 };
      "use server";
      import { decryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { __actionShared0 as moduleVar, __actionShared1 as test2 } from "foo";
      export async function a0(closure, arg) {
          var [foo, bound, bar] = await decryptClosure(closure);
          "use server";
          console.log(foo, bound, doSomething(bar).a, moduleVar, test2, arg);
      }
      "#}
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let action = function () {
        "use server";
        console.log('hello');
      };
    }
    "#,
      run,
    );
    assert_eq!(res.1[0].message, "React Server Functions must be async");

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let action = async function *() {
        "use server";
        console.log('hello');
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be generators"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let action = async function () {
        "use server";
        console.log(this);
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`this` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let action = async function () {
        "use server";
        console.log(arguments[0]);
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`arguments` is not allowed in React Server Functions"
    );
  }

  #[test]
  fn test_fn_decl() {
    let code = r#"
    function ServerComponent() {
      async function action() {
        "use server";
        console.log('hello');
      }
    }
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { a0 } from "parcel:server-actions";
      function ServerComponent() {
          var action = a0;
      }
      "use server";
      export async function a0() {
          "use server";
          console.log('hello');
      }
      "#}
    );

    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  async function action(arg) {
    "use server";
    console.log(foo, bar.baz, doSomething(bar).a, moduleVar, arg);
  }
}
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { encryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { a0 } from "parcel:server-actions";
      let moduleVar = 2;
      function ServerComponent({ foo, bar }) {
          var action = a0.bind(null, encryptClosure([
              foo,
              bar.baz,
              bar
          ]));
      }
      export { moduleVar as __actionShared0 };
      "use server";
      import { decryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { __actionShared0 as moduleVar } from "foo";
      export async function a0(closure, arg) {
          var [foo, bound, bar] = await decryptClosure(closure);
          "use server";
          console.log(foo, bound, doSomething(bar).a, moduleVar, arg);
      }
      "#}
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      function action() {
        "use server";
        console.log('hello');
      }
    }
    "#,
      run,
    );
    assert_eq!(res.1[0].message, "React Server Functions must be async");

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      async function *action() {
        "use server";
        console.log('hello');
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be generators"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      async function action() {
        "use server";
        console.log(this);
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`this` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      async function action() {
        "use server";
        console.log(arguments[0]);
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`arguments` is not allowed in React Server Functions"
    );
  }

  #[test]
  fn test_object_method() {
    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  let test = {
    async action(arg) {
      "use server";
      console.log(foo, bar.baz, doSomething(bar).a, moduleVar, arg);
    }
  };
}
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { encryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { a0 } from "parcel:server-actions";
      let moduleVar = 2;
      function ServerComponent({ foo, bar }) {
          let test = {
              action: a0.bind(null, encryptClosure([
                  foo,
                  bar.baz,
                  bar
              ]))
          };
      }
      export { moduleVar as __actionShared0 };
      "use server";
      import { decryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { __actionShared0 as moduleVar } from "foo";
      export async function a0(closure, arg) {
          var [foo, bound, bar] = await decryptClosure(closure);
          "use server";
          console.log(foo, bound, doSomething(bar).a, moduleVar, arg);
      }
      "#}
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let test = {
        action() {
          "use server";
          console.log('hello');
        }
      };
    }
    "#,
      run,
    );
    assert_eq!(res.1[0].message, "React Server Functions must be async");

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let test = {
        async *action() {
          "use server";
          console.log('hello');
        }
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be generators"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let test = {
        async action() {
          "use server";
          console.log(this);
        }
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`this` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      let test = {
        async action() {
          "use server";
          console.log(arguments[0]);
        }
      };
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`arguments` is not allowed in React Server Functions"
    );
  }

  #[test]
  fn test_class_method() {
    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  class Test {
    static async action(arg) {
      "use server";
      console.log(foo, bar.baz, doSomething(bar).a, moduleVar, arg);
    }
  }
}
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { encryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { a0 } from "parcel:server-actions";
      let moduleVar = 2;
      function ServerComponent({ foo, bar }) {
          class Test {
              static action = a0.bind(null, encryptClosure([
                  foo,
                  bar.baz,
                  bar
              ]));
          }
      }
      export { moduleVar as __actionShared0 };
      "use server";
      import { decryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { __actionShared0 as moduleVar } from "foo";
      export async function a0(closure, arg) {
          var [foo, bound, bar] = await decryptClosure(closure);
          "use server";
          console.log(foo, bound, doSomething(bar).a, moduleVar, arg);
      }
      "#}
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static action() {
          "use server";
          console.log('hello');
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(res.1[0].message, "React Server Functions must be async");

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async *action() {
          "use server";
          console.log('hello');
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be generators"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async action() {
          "use server";
          console.log(this);
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`this` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async action() {
          "use server";
          console.log(arguments[0]);
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`arguments` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        async action() {
          "use server";
          console.log('hi');
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be instance methods"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async action() {
          "use server";
          super.action();
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`super` is not allowed in React Server Functions"
    );
  }

  #[test]
  fn test_class_private_method() {
    let code = r#"
let moduleVar = 2;
function ServerComponent({foo, bar}) {
  class Test {
    static async #action(arg) {
      "use server";
      console.log(foo, bar.baz, doSomething(bar).a, moduleVar, arg);
    }
  }
}
    "#;

    let res = run_with_transformation(code, run);
    assert_eq!(
      res.0,
      indoc! {r#"
      import { encryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { a0 } from "parcel:server-actions";
      let moduleVar = 2;
      function ServerComponent({ foo, bar }) {
          class Test {
              static #action = a0.bind(null, encryptClosure([
                  foo,
                  bar.baz,
                  bar
              ]));
          }
      }
      export { moduleVar as __actionShared0 };
      "use server";
      import { decryptClosure } from "@parcel/transformer-js/src/rsc-utils.js";
      import { __actionShared0 as moduleVar } from "foo";
      export async function a0(closure, arg) {
          var [foo, bound, bar] = await decryptClosure(closure);
          "use server";
          console.log(foo, bound, doSomething(bar).a, moduleVar, arg);
      }
      "#}
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static #action() {
          "use server";
          console.log('hello');
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(res.1[0].message, "React Server Functions must be async");

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async *#action() {
          "use server";
          console.log('hello');
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be generators"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async #action() {
          "use server";
          console.log(this);
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`this` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        static async #action() {
          "use server";
          console.log(arguments[0]);
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "`arguments` is not allowed in React Server Functions"
    );

    let res = run_with_transformation(
      r#"
    function ServerComponent() {
      class Test {
        async #action() {
          "use server";
          console.log('hi');
        }
      }
    }
    "#,
      run,
    );
    assert_eq!(
      res.1[0].message,
      "React Server Functions cannot be instance methods"
    );
  }
}
