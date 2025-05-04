use parcel_core::{
  CodeFrame, CodeHighlight, Diagnostic, DiagnosticSeverity, Location, SourceLocation, SourceType,
};
use swc_core::{
  common::{
    DUMMY_SP, FileName, Mark, SourceMap, Span, SyntaxContext,
    errors::{DiagnosticBuilder, Emitter},
  },
  ecma::{
    ast::{self, Ident, IdentName},
    atoms::Atom as JsWord,
  },
};

pub fn is_unresolved(ident: &Ident, unresolved_mark: Mark) -> bool {
  ident.ctxt.outer() == unresolved_mark
}

pub fn match_member_expr(expr: &ast::MemberExpr, idents: Vec<&str>, unresolved_mark: Mark) -> bool {
  use ast::{Expr, Lit, MemberProp, Str};

  let mut member = expr;
  let mut idents = idents;
  while idents.len() > 1 {
    let expected = idents.pop().unwrap();
    let prop = match &member.prop {
      MemberProp::Computed(comp) => {
        if let Expr::Lit(Lit::Str(Str { value: ref sym, .. })) = *comp.expr {
          sym
        } else {
          return false;
        }
      }
      MemberProp::Ident(IdentName { sym, .. }) => sym,
      _ => return false,
    };

    if prop != expected {
      return false;
    }

    match &*member.obj {
      Expr::Member(m) => member = m,
      Expr::Ident(id) => {
        return idents.len() == 1
          && id.sym == idents.pop().unwrap()
          && is_unresolved(&id, unresolved_mark);
      }
      _ => return false,
    }
  }

  false
}

pub fn create_require(
  specifier: JsWord,
  unresolved_mark: Mark,
  source_type: SourceType,
) -> ast::CallExpr {
  ast::CallExpr {
    callee: ast::Callee::Expr(Box::new(ast::Expr::Ident(ast::Ident::new(
      if source_type == SourceType::Script {
        "__parcel__require__"
      } else {
        "require"
      }
      .into(),
      DUMMY_SP,
      SyntaxContext::empty().apply_mark(unresolved_mark),
    )))),
    args: vec![ast::ExprOrSpread {
      expr: Box::new(ast::Expr::Lit(ast::Lit::Str(specifier.into()))),
      spread: None,
    }],
    span: DUMMY_SP,
    ctxt: SyntaxContext::empty(),
    type_args: None,
  }
}

pub fn create_url_constructor(url: ast::Expr, use_import_meta: bool) -> ast::Expr {
  use ast::*;

  let expr = if use_import_meta {
    Expr::Member(MemberExpr {
      span: DUMMY_SP,
      obj: Box::new(Expr::MetaProp(MetaPropExpr {
        kind: MetaPropKind::ImportMeta,
        span: DUMMY_SP,
      })),
      prop: MemberProp::Ident(IdentName::new("url".into(), DUMMY_SP)),
    })
  } else {
    // CJS output: "file:" + __filename
    Expr::Bin(BinExpr {
      span: DUMMY_SP,
      left: Box::new(Expr::Lit(Lit::Str("file:".into()))),
      op: BinaryOp::Add,
      right: Box::new(Expr::Ident(Ident::new_no_ctxt(
        "__filename".into(),
        DUMMY_SP,
      ))),
    })
  };

  Expr::New(NewExpr {
    span: DUMMY_SP,
    ctxt: SyntaxContext::empty(),
    callee: Box::new(Expr::Ident(Ident::new_no_ctxt("URL".into(), DUMMY_SP))),
    args: Some(vec![
      ExprOrSpread {
        expr: Box::new(url),
        spread: None,
      },
      ExprOrSpread {
        expr: Box::new(expr),
        spread: None,
      },
    ]),
    type_args: None,
  })
}

fn is_marked(mut ctxt: SyntaxContext, mark: Mark) -> bool {
  loop {
    let m = ctxt.remove_mark();
    if m == Mark::root() {
      return false;
    }

    if m == mark {
      return true;
    }
  }
}

pub fn match_str(node: &ast::Expr) -> Option<(JsWord, Span)> {
  use ast::*;

  match node {
    // "string" or 'string'
    Expr::Lit(Lit::Str(s)) => Some((s.value.clone(), s.span)),
    // `string`
    Expr::Tpl(tpl) if tpl.quasis.len() == 1 && tpl.exprs.is_empty() => {
      Some(((*tpl.quasis[0].raw).into(), tpl.span))
    }
    _ => None,
  }
}

pub fn match_property_name(node: &ast::MemberExpr) -> Option<(JsWord, Span)> {
  match &node.prop {
    ast::MemberProp::Computed(s) => match_str(&s.expr),
    ast::MemberProp::Ident(id) => Some((id.sym.clone(), id.span)),
    ast::MemberProp::PrivateName(_) => None,
  }
}

pub fn match_export_name(name: &ast::ModuleExportName) -> (JsWord, Span) {
  match name {
    ast::ModuleExportName::Ident(id) => (id.sym.clone(), id.span),
    ast::ModuleExportName::Str(s) => (s.value.clone(), s.span),
  }
}

/// Properties like `ExportNamedSpecifier::orig` have to be an Ident if `src` is `None`
pub fn match_export_name_ident(name: &ast::ModuleExportName) -> &ast::Ident {
  match name {
    ast::ModuleExportName::Ident(id) => id,
    ast::ModuleExportName::Str(_) => unreachable!(),
  }
}

pub fn match_require(node: &ast::Expr, unresolved_mark: Mark, ignore_mark: Mark) -> Option<JsWord> {
  use ast::*;

  match node {
    Expr::Call(call) => match &call.callee {
      Callee::Expr(expr) => match &**expr {
        Expr::Ident(ident) => {
          if ident.sym == "require"
            && is_unresolved(&ident, unresolved_mark)
            && !is_marked(ident.ctxt, ignore_mark)
          {
            if let Some(arg) = call.args.first() {
              return match_str(&arg.expr).map(|(name, _)| name);
            }
          }

          None
        }
        Expr::Member(member) => {
          if match_member_expr(member, vec!["module", "require"], unresolved_mark) {
            if let Some(arg) = call.args.first() {
              return match_str(&arg.expr).map(|(name, _)| name);
            }
          }

          None
        }
        _ => None,
      },
      _ => None,
    },
    _ => None,
  }
}

pub fn match_import(node: &ast::Expr) -> Option<JsWord> {
  use ast::*;

  match node {
    Expr::Call(call) => match &call.callee {
      Callee::Import(_) => {
        if let Some(arg) = call.args.first() {
          return match_str(&arg.expr).map(|(name, _)| name);
        }
        None
      }
      _ => None,
    },
    _ => None,
  }
}

// `name` must not be an existing binding.
pub fn create_global_decl_stmt(
  name: JsWord,
  init: ast::Expr,
  global_mark: Mark,
) -> (ast::Stmt, SyntaxContext) {
  // The correct value would actually be `DUMMY_SP.apply_mark(Mark::fresh(Mark::root()))`.
  // But this saves us from running the resolver again in some cases.
  let ctxt = SyntaxContext::empty().apply_mark(global_mark);

  (
    ast::Stmt::Decl(ast::Decl::Var(Box::new(ast::VarDecl {
      kind: ast::VarDeclKind::Var,
      declare: false,
      span: DUMMY_SP,
      ctxt,
      decls: vec![ast::VarDeclarator {
        name: ast::Pat::Ident(ast::BindingIdent::from(ast::Ident::new(
          name, DUMMY_SP, ctxt,
        ))),
        span: DUMMY_SP,
        definite: false,
        init: Some(Box::new(init)),
      }],
    }))),
    ctxt,
  )
}

pub fn get_undefined_ident(unresolved_mark: Mark) -> ast::Ident {
  ast::Ident::new(
    "undefined".into(),
    DUMMY_SP,
    SyntaxContext::empty().apply_mark(unresolved_mark),
  )
}

pub fn loc(span: Span, source_map: &SourceMap) -> SourceLocation {
  if span.lo.is_dummy() || span.hi.is_dummy() {
    return SourceLocation {
      file_path: "unknown".into(),
      start: Location { line: 1, column: 1 },
      end: Location { line: 1, column: 2 },
    };
  }

  let start = source_map.lookup_char_pos(span.lo);
  let end = source_map.lookup_char_pos(span.hi);
  // SWC's columns are exclusive, ours are exclusive
  // SWC has 0-based columns, ours are 1-based (column + 1)
  SourceLocation {
    file_path: match &*start.file.name {
      FileName::Real(p) => p.clone(),
      p => p.to_string().into(),
    },
    start: Location {
      line: start.line as u32,
      column: (start.col_display + 1) as u32,
    },
    end: Location {
      line: end.line as u32,
      column: (end.col_display + 1) as u32,
    },
  }
}

#[derive(Debug)]
pub struct Bailout {
  pub loc: SourceLocation,
  pub reason: BailoutReason,
}

impl Bailout {
  pub fn to_diagnostic(&self) -> Diagnostic {
    let (message, documentation_url) = self.reason.info();
    let mut diagnostic = Diagnostic::from_loc(self.loc.clone(), message);
    diagnostic.documentation_url = Some(documentation_url.into());
    diagnostic.severity = DiagnosticSeverity::Warning;
    diagnostic
  }
}

#[derive(Debug, Eq, PartialEq)]
pub enum BailoutReason {
  NonTopLevelRequire,
  NonStaticDestructuring,
  TopLevelReturn,
  Eval,
  NonStaticExports,
  FreeModule,
  FreeExports,
  ExportsReassignment,
  ModuleReassignment,
  NonStaticDynamicImport,
  NonStaticAccess,
  ThisInExport,
}

impl BailoutReason {
  fn info(&self) -> (&str, &str) {
    match self {
      BailoutReason::NonTopLevelRequire => (
        "Conditional or non-top-level `require()` call. This causes the resolved module and all dependencies to be wrapped.",
        "https://parceljs.org/features/scope-hoisting/#avoid-conditional-require()",
      ),
      BailoutReason::NonStaticDestructuring => (
        "Non-static destructuring of `require` or dynamic `import()`. This causes all exports of the resolved module to be included.",
        "https://parceljs.org/features/scope-hoisting/#commonjs",
      ),
      BailoutReason::TopLevelReturn => (
        "Module contains a top-level `return` statement. This causes the module to be wrapped in a function and tree shaking to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#avoid-top-level-return",
      ),
      BailoutReason::Eval => (
        "Module contains usage of `eval`. This causes the module to be wrapped in a function and minification to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#avoid-eval",
      ),
      BailoutReason::NonStaticExports => (
        "Non-static access of CommonJS `exports` object. This causes tree shaking to be disabled for the module.",
        "https://parceljs.org/features/scope-hoisting/#commonjs",
      ),
      BailoutReason::FreeModule => (
        "Unknown usage of CommonJS `module` object. This causes the module to be wrapped, and tree shaking to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#commonjs",
      ),
      BailoutReason::FreeExports => (
        "Unknown usage of CommonJS `exports` object. This causes tree shaking to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#commonjs",
      ),
      BailoutReason::ExportsReassignment => (
        "Module contains a reassignment of the CommonJS `exports` object. This causes the module to be wrapped and tree-shaking to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#avoid-module-and-exports-re-assignment",
      ),
      BailoutReason::ModuleReassignment => (
        "Module contains a reassignment of the CommonJS `module` object. This causes the module to be wrapped and tree-shaking to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#avoid-module-and-exports-re-assignment",
      ),
      BailoutReason::NonStaticDynamicImport => (
        "Unknown dynamic import usage. This causes tree shaking to be disabled for the resolved module.",
        "https://parceljs.org/features/scope-hoisting/#dynamic-imports",
      ),
      BailoutReason::NonStaticAccess => (
        "Non-static access of an `import` or `require`. This causes tree shaking to be disabled for the resolved module.",
        "https://parceljs.org/features/scope-hoisting/#dynamic-member-accesses",
      ),
      BailoutReason::ThisInExport => (
        "Module contains `this` access of an exported value. This causes the module to be wrapped and tree-shaking to be disabled.",
        "https://parceljs.org/features/scope-hoisting/#avoiding-bail-outs",
      ),
    }
  }
}

#[macro_export]
macro_rules! fold_member_expr_skip_prop {
  () => {
    fn fold_member_expr(
      &mut self,
      mut node: swc_core::ecma::ast::MemberExpr,
    ) -> swc_core::ecma::ast::MemberExpr {
      node.obj = node.obj.fold_with(self);

      if let swc_core::ecma::ast::MemberProp::Computed(_) = node.prop {
        node.prop = node.prop.fold_with(self);
      }

      node
    }
  };
}

#[macro_export]
macro_rules! id {
  ($ident: expr) => {
    $ident.to_id()
  };
}

#[derive(Debug, Clone, Default)]
pub struct ErrorBuffer(
  std::sync::Arc<parking_lot::Mutex<Vec<swc_core::common::errors::Diagnostic>>>,
);

impl Emitter for ErrorBuffer {
  fn emit(&mut self, db: &mut DiagnosticBuilder) {
    self.0.lock().push((**db).clone());
  }
}

pub fn error_buffer_to_diagnostics(
  error_buffer: &ErrorBuffer,
  source_map: &SourceMap,
) -> Vec<Diagnostic> {
  let s = error_buffer.0.lock().clone();
  s.iter()
    .map(|diagnostic| {
      let message = diagnostic.message();
      let span = diagnostic.span.clone();
      let suggestions = diagnostic.suggestions.clone();

      let span_labels = span.span_labels();
      let mut code_highlights = vec![];
      for span_label in span_labels {
        code_highlights.push(CodeHighlight::from_loc(
          loc(span_label.span, source_map),
          span_label.label,
        ));
      }

      let hints = suggestions
        .into_iter()
        .map(|suggestion| suggestion.msg)
        .collect();

      Diagnostic {
        origin: None,
        message,
        code_frames: if !code_highlights.is_empty() {
          vec![CodeFrame {
            file_path: span.primary_span().map(|p| loc(p, source_map).file_path),
            code: None,
            code_highlights,
            language: None,
          }]
        } else {
          vec![]
        },
        hints,
        severity: DiagnosticSeverity::Error,
        documentation_url: None,
      }
    })
    .collect()
}
