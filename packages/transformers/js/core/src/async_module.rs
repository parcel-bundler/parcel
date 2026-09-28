//! Wraps a module that the runtime's async module evaluator runs (see `crates/js/src/tla-runtime.js`)
//! because it uses top-level await, or imports a module that does. Like webpack's async modules, its
//! body becomes a single async function, entered when the module is first required:
//!
//! ```js
//! require('_tla').enter(module, imports, hasTLA, async function ($parcel$tla) {
//!   try {
//!     <its exports, then requires of its static imports>
//!     var $parcel$wait = $parcel$tla(); if ($parcel$wait) (await $parcel$wait)();
//!     <the rest of its body>
//!     $parcel$tla.d();
//!   } catch ($parcel$error) { $parcel$tla.c($parcel$error); }
//! });
//! ```
//!
//! The body keeps its scope, so its bindings behave as usual: requiring its imports assigns their
//! bindings, like linking, before the evaluator decides whether the rest of the body waits.

use swc_core::{
  common::{DUMMY_SP, Mark, SyntaxContext},
  ecma::ast::*,
};

use crate::Ast;

/// `prologue_len` is the number of statements the module starts with that define its exports and
/// require its imports (from `esm2cjs`), within the `try` block of its last statement if it's wrapped
/// for React Refresh.
pub fn wrap_async_module(
  ast: &mut Ast,
  prologue_len: usize,
  react_refresh_wrapped: bool,
  imports: &[String],
  has_top_level_await: bool,
) {
  let globals = ast.globals.clone();
  swc_core::common::GLOBALS.set(&globals, || {
    let unresolved = SyntaxContext::empty().apply_mark(ast.unresolved_mark);
    // Names the module can't see, from a fresh mark. Unminified output prints them as is.
    let private = SyntaxContext::empty().apply_mark(Mark::new());
    let gate = Ident::new("$parcel$tla".into(), DUMMY_SP, private);
    let wait = Ident::new("$parcel$wait".into(), DUMMY_SP, private);
    let error = Ident::new("$parcel$error".into(), DUMMY_SP, private);

    let mut body: Vec<Stmt> = std::mem::take(&mut ast.program.body)
      .into_iter()
      .map(|item| item.expect_stmt())
      .collect();
    let stmts = if react_refresh_wrapped {
      match body.last_mut() {
        Some(Stmt::Try(try_stmt)) => &mut try_stmt.block.stmts,
        _ => unreachable!("React Refresh wraps the module in a try statement"),
      }
    } else {
      &mut body
    };
    let at = prologue_len.min(stmts.len());
    stmts.splice(at..at, wait_for_imports(&gate, &wait));
    body.push(expr_stmt(call(member(&gate, "d"), vec![])));

    let function = Expr::Fn(FnExpr {
      ident: None,
      function: Box::new(Function {
        params: vec![Param {
          span: DUMMY_SP,
          decorators: vec![],
          pat: Pat::Ident(gate.clone().into()),
        }],
        body: Some(FunctionBody {
          stmts: vec![Stmt::Try(Box::new(TryStmt {
            span: DUMMY_SP,
            block: BlockStmt {
              stmts: body,
              ..Default::default()
            },
            handler: Some(CatchClause {
              span: DUMMY_SP,
              param: Some(Pat::Ident(error.clone().into())),
              body: BlockStmt {
                stmts: vec![expr_stmt(call(
                  member(&gate, "c"),
                  vec![Expr::Ident(error)],
                ))],
                ..Default::default()
              },
            }),
            finalizer: None,
          }))],
          ..Default::default()
        }),
        is_async: true,
        ..Default::default()
      }),
    });

    let evaluator = call(
      Expr::Ident(Ident::new("require".into(), DUMMY_SP, unresolved)),
      vec!["_tla".into()],
    );
    let enter = call(
      member_of(evaluator, "enter"),
      vec![
        Expr::Ident(Ident::new("module".into(), DUMMY_SP, unresolved)),
        Expr::Array(ArrayLit {
          span: DUMMY_SP,
          elems: imports
            .iter()
            .map(|id| Some(Expr::from(id.as_str()).into()))
            .collect(),
        }),
        Expr::Lit(Lit::Num(Number {
          span: DUMMY_SP,
          value: if has_top_level_await { 1.0 } else { 0.0 },
          raw: None,
        })),
        function,
      ],
    );
    ast.program.body = vec![ModuleItem::Stmt(expr_stmt(enter))];
  });
}

/// `var $parcel$wait = $parcel$tla(); if ($parcel$wait) (await $parcel$wait)();`
fn wait_for_imports(gate: &Ident, wait: &Ident) -> Vec<Stmt> {
  vec![
    Stmt::Decl(Decl::Var(Box::new(VarDecl {
      kind: VarDeclKind::Var,
      decls: vec![VarDeclarator {
        span: DUMMY_SP,
        name: Pat::Ident(wait.clone().into()),
        init: Some(Box::new(call(Expr::Ident(gate.clone()), vec![]))),
        definite: false,
      }],
      ..Default::default()
    }))),
    Stmt::If(IfStmt {
      span: DUMMY_SP,
      test: Box::new(Expr::Ident(wait.clone())),
      cons: Box::new(expr_stmt(call(
        Expr::Paren(ParenExpr {
          span: DUMMY_SP,
          expr: Box::new(Expr::Await(AwaitExpr {
            span: DUMMY_SP,
            arg: Box::new(Expr::Ident(wait.clone())),
          })),
        }),
        vec![],
      ))),
      alt: None,
    }),
  ]
}

fn expr_stmt(expr: Expr) -> Stmt {
  Stmt::Expr(ExprStmt {
    span: DUMMY_SP,
    expr: Box::new(expr),
  })
}

fn call(callee: Expr, args: Vec<Expr>) -> Expr {
  Expr::Call(CallExpr {
    callee: Callee::Expr(Box::new(callee)),
    args: args.into_iter().map(|arg| arg.into()).collect(),
    ..Default::default()
  })
}

fn member(obj: &Ident, prop: &str) -> Expr {
  member_of(Expr::Ident(obj.clone()), prop)
}

fn member_of(obj: Expr, prop: &str) -> Expr {
  Expr::Member(MemberExpr {
    span: DUMMY_SP,
    obj: Box::new(obj),
    prop: MemberProp::Ident(IdentName::new(prop.into(), DUMMY_SP)),
  })
}
