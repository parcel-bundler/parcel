use std::collections::HashMap;
use std::sync::Arc;

use swc_core::common::errors::Handler;
use swc_core::common::util::take::Take;
use swc_core::common::{sync::Lrc, SourceMap, Span, DUMMY_SP};
use swc_core::ecma::ast::*;
use swc_core::ecma::atoms::{js_word, JsWord};
use swc_core::ecma::parser::lexer::Lexer;
use swc_core::ecma::parser::{Parser, StringInput};
use swc_core::ecma::visit::{Fold, FoldWith};

use crate::utils::{
  error_buffer_to_diagnostics, match_export_name, match_property_name, CodeHighlight, Diagnostic,
  ErrorBuffer, SourceLocation,
};

pub type MacroCallback =
  Arc<dyn Fn(String, String, Vec<JsValue>) -> Result<JsValue, String> + Send + Sync>;

pub struct Macros<'a> {
  /// Mapping of imported identifiers to import metadata.
  macros: HashMap<Id, MacroImport>,
  callback: MacroCallback,
  source_map: &'a SourceMap,
  diagnostics: &'a mut Vec<Diagnostic>,
}

struct MacroImport {
  /// The import specifier.
  src: JsWord,
  /// The imported identifier. None if this is a namespace import.
  imported: Option<JsWord>,
}

impl<'a> Macros<'a> {
  pub fn new(
    callback: MacroCallback,
    source_map: &'a SourceMap,
    diagnostics: &'a mut Vec<Diagnostic>,
  ) -> Self {
    Macros {
      macros: HashMap::new(),
      callback,
      source_map,
      diagnostics,
    }
  }

  fn add_macro(&mut self, import: &ImportDecl) {
    for specifier in &import.specifiers {
      match specifier {
        ImportSpecifier::Named(named) => {
          let imported = match &named.imported {
            Some(imported) => match_export_name(imported).0.clone(),
            None => named.local.sym.clone(),
          };
          self.macros.insert(
            named.local.to_id(),
            MacroImport {
              src: import.src.value.clone(),
              imported: Some(imported),
            },
          );
        }
        ImportSpecifier::Default(default) => {
          self.macros.insert(
            default.local.to_id(),
            MacroImport {
              src: import.src.value.clone(),
              imported: Some(js_word!("default")),
            },
          );
        }
        ImportSpecifier::Namespace(namespace) => {
          self.macros.insert(
            namespace.local.to_id(),
            MacroImport {
              src: import.src.value.clone(),
              imported: None,
            },
          );
        }
      }
    }
  }

  fn call_macro(&self, src: &JsWord, export: &JsWord, call: &CallExpr) -> Result<Expr, Diagnostic> {
    // Try to statically evaluate all of the function arguments.
    let mut args = Vec::with_capacity(call.args.len());
    for arg in &call.args {
      match eval(&*arg.expr) {
        Ok(val) => {
          if arg.spread.is_none() {
            args.push(val);
          } else if let JsValue::Array(val) = val {
            args.extend(val);
          } else {
            return Err(self.create_diagnostic(call.span));
          }
        }
        Err(span) => {
          return Err(self.create_diagnostic(span));
        }
      }
    }

    // If that was successful, call the function callback (on the JS thread).
    match (self.callback)(src.to_string(), export.to_string(), args) {
      Ok(val) => Ok(Expr::try_from(val)?),
      Err(err) => Err(Diagnostic {
        message: format!("Error evaluating macro: {}", err),
        code_highlights: Some(vec![CodeHighlight {
          message: None,
          loc: SourceLocation::from(self.source_map, call.span),
        }]),
        hints: None,
        show_environment: false,
        severity: crate::utils::DiagnosticSeverity::Error,
        documentation_url: None,
      }),
    }
  }

  fn create_diagnostic(&self, span: Span) -> Diagnostic {
    Diagnostic {
      message: "Could not statically evaluate macro argument".into(),
      code_highlights: Some(vec![CodeHighlight {
        message: None,
        loc: SourceLocation::from(self.source_map, span),
      }]),
      hints: None,
      show_environment: false,
      severity: crate::utils::DiagnosticSeverity::Error,
      documentation_url: None,
    }
  }
}

impl<'a> Fold for Macros<'a> {
  fn fold_module(&mut self, mut node: Module) -> Module {
    // Pre-pass to find all macro imports.
    node.body.retain(|item| {
      if let ModuleItem::ModuleDecl(decl) = &item {
        if let ModuleDecl::Import(import) = &decl {
          if matches!(&import.with, Some(with) if is_macro(with)) {
            self.add_macro(import);
            return false;
          }
        }
      }

      true
    });

    // Only process the rest of the AST if we found any macro imports.
    if !self.macros.is_empty() {
      node = node.fold_children_with(self);
    }

    node
  }

  fn fold_expr(&mut self, mut node: Expr) -> Expr {
    node = node.fold_children_with(self);

    if let Expr::Call(call) = &node {
      if let Callee::Expr(expr) = &call.callee {
        match &**expr {
          Expr::Ident(ident) => {
            if let Some(specifier) = self.macros.get(&ident.to_id()) {
              if let Some(imported) = &specifier.imported {
                return handle_error(
                  self.call_macro(&specifier.src, imported, call),
                  &mut self.diagnostics,
                );
              }
            }
          }
          Expr::Member(member) => {
            // e.g. ns.macro()
            if let Expr::Ident(ident) = &*member.obj {
              if let (Some(specifier), Some(prop)) = (
                self.macros.get(&ident.to_id()),
                match_property_name(&member),
              ) {
                // Check that this is a namespace import.
                if specifier.imported.is_none() {
                  return handle_error(
                    self.call_macro(&specifier.src, &prop.0, call),
                    &mut self.diagnostics,
                  );
                }
              }
            }
          }
          _ => {}
        }
      }
    }

    node
  }
}

/// Checks if an object literal (from import attributes) has type: 'macro'.
fn is_macro(with: &ObjectLit) -> bool {
  for prop in &with.props {
    if let PropOrSpread::Prop(prop) = &prop {
      if let Prop::KeyValue(kv) = &**prop {
        let k = match &kv.key {
          PropName::Ident(Ident { sym, .. }) | PropName::Str(Str { value: sym, .. }) => sym.clone(),
          _ => continue,
        };
        if &k == "type"
          && matches!(&*kv.value, Expr::Lit(Lit::Str(Str { value, .. })) if value == "macro")
        {
          return true;
        }
      }
    }
  }

  false
}

fn handle_error(result: Result<Expr, Diagnostic>, diagnostics: &mut Vec<Diagnostic>) -> Expr {
  match result {
    Ok(expr) => expr,
    Err(err) => {
      diagnostics.push(err);
      Expr::Lit(Lit::Null(Null::dummy()))
    }
  }
}

// A type that represents a basic JS value.
pub enum JsValue {
  Undefined,
  Null,
  Bool(bool),
  Number(f64),
  String(String),
  Regex { source: String, flags: String },
  Array(Vec<JsValue>),
  Object(Vec<(String, JsValue)>),
  Function(String),
}

/// Statically evaluate a JS expression to a value, if possible.
fn eval(expr: &Expr) -> Result<JsValue, Span> {
  match expr.unwrap_parens() {
    Expr::Lit(lit) => match lit {
      Lit::Null(_) => Ok(JsValue::Null),
      Lit::Bool(v) => Ok(JsValue::Bool(v.value)),
      Lit::Num(v) => Ok(JsValue::Number(v.value)),
      Lit::Str(v) => Ok(JsValue::String(v.value.to_string())),
      Lit::JSXText(v) => Ok(JsValue::String(v.value.to_string())),
      Lit::Regex(v) => Ok(JsValue::Regex {
        source: v.exp.to_string(),
        flags: v.flags.to_string(),
      }),
      Lit::BigInt(v) => Err(v.span),
    },
    Expr::Tpl(tpl) => {
      let exprs: Vec<_> = tpl
        .exprs
        .iter()
        .filter_map(|expr| eval(&*expr).ok())
        .collect();
      if exprs.len() == tpl.exprs.len() {
        let mut res = String::new();
        let mut expr_iter = exprs.iter();
        for quasi in &tpl.quasis {
          res.push_str(&quasi.raw);
          match expr_iter.next() {
            None => {}
            Some(JsValue::String(s)) => res.push_str(s),
            Some(JsValue::Number(n)) => res.push_str(&n.to_string()),
            Some(JsValue::Bool(b)) => res.push_str(&b.to_string()),
            _ => return Err(tpl.span),
          }
        }

        Ok(JsValue::String(res))
      } else {
        Err(tpl.span)
      }
    }
    Expr::Array(arr) => {
      let mut res = Vec::with_capacity(arr.elems.len());
      for elem in &arr.elems {
        if let Some(elem) = elem {
          match eval(&*elem.expr) {
            Err(e) => return Err(e),
            Ok(val) => {
              if elem.spread.is_some() {
                match val {
                  JsValue::Array(arr) => {
                    res.extend(arr);
                  }
                  _ => return Err(arr.span),
                }
              } else {
                res.push(val);
              }
            }
          }
        } else {
          res.push(JsValue::Undefined);
        }
      }
      Ok(JsValue::Array(res))
    }
    Expr::Object(obj) => {
      let mut res = Vec::with_capacity(obj.props.len());
      for prop in &obj.props {
        match prop {
          PropOrSpread::Prop(prop) => match &**prop {
            Prop::KeyValue(kv) => match eval(&*kv.value) {
              Err(e) => return Err(e),
              Ok(v) => {
                let k = match &kv.key {
                  PropName::Ident(Ident { sym, .. }) | PropName::Str(Str { value: sym, .. }) => {
                    sym.to_string()
                  }
                  PropName::Num(n) => n.value.to_string(),
                  PropName::Computed(c) => match eval(&*c.expr) {
                    Err(e) => return Err(e),
                    Ok(JsValue::String(s)) => s,
                    Ok(JsValue::Number(n)) => n.to_string(),
                    Ok(JsValue::Bool(b)) => b.to_string(),
                    _ => return Err(c.span),
                  },
                  PropName::BigInt(v) => return Err(v.span),
                };

                res.push((k.to_string(), v))
              }
            },
            _ => return Err(obj.span),
          },
          PropOrSpread::Spread(spread) => match eval(&*spread.expr) {
            Err(e) => return Err(e),
            Ok(v) => match v {
              JsValue::Object(o) => res.extend(o),
              _ => return Err(obj.span),
            },
          },
        }
      }
      Ok(JsValue::Object(res))
    }
    Expr::Bin(bin) => match (bin.op, eval(&*bin.left), eval(&*bin.right)) {
      (BinaryOp::Add, Ok(JsValue::String(a)), Ok(JsValue::String(b))) => {
        Ok(JsValue::String(format!("{}{}", a, b)))
      }
      (BinaryOp::BitAnd, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(((a as i32) & (b as i32)) as f64))
      }
      (BinaryOp::BitOr, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(((a as i32) | (b as i32)) as f64))
      }
      (BinaryOp::BitXor, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(((a as i32) ^ (b as i32)) as f64))
      }
      (BinaryOp::LShift, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(((a as i32) << (b as i32)) as f64))
      }
      (BinaryOp::RShift, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(((a as i32) >> (b as i32)) as f64))
      }
      (BinaryOp::ZeroFillRShift, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(((a as i32) >> (b as u32)) as f64))
      }
      (BinaryOp::Add, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Number(a + b)),
      (BinaryOp::Sub, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Number(a - b)),
      (BinaryOp::Div, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Number(a / b)),
      (BinaryOp::Mul, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Number(a * b)),
      (BinaryOp::Mod, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Number(a % b)),
      (BinaryOp::Exp, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Number(a.powf(b)))
      }
      (BinaryOp::EqEq, Ok(JsValue::Bool(a)), Ok(JsValue::Bool(b))) => Ok(JsValue::Bool(a == b)),
      (BinaryOp::EqEqEq, Ok(JsValue::Bool(a)), Ok(JsValue::Bool(b))) => Ok(JsValue::Bool(a == b)),
      (BinaryOp::NotEq, Ok(JsValue::Bool(a)), Ok(JsValue::Bool(b))) => Ok(JsValue::Bool(a != b)),
      (BinaryOp::NotEqEq, Ok(JsValue::Bool(a)), Ok(JsValue::Bool(b))) => Ok(JsValue::Bool(a != b)),
      (BinaryOp::EqEq, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Bool(a == b)),
      (BinaryOp::EqEqEq, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Bool(a == b))
      }
      (BinaryOp::NotEq, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Bool(a != b))
      }
      (BinaryOp::NotEqEq, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => {
        Ok(JsValue::Bool(a != b))
      }
      (BinaryOp::EqEq, Ok(JsValue::String(a)), Ok(JsValue::String(b))) => Ok(JsValue::Bool(a == b)),
      (BinaryOp::EqEqEq, Ok(JsValue::String(a)), Ok(JsValue::String(b))) => {
        Ok(JsValue::Bool(a == b))
      }
      (BinaryOp::NotEq, Ok(JsValue::String(a)), Ok(JsValue::String(b))) => {
        Ok(JsValue::Bool(a != b))
      }
      (BinaryOp::NotEqEq, Ok(JsValue::String(a)), Ok(JsValue::String(b))) => {
        Ok(JsValue::Bool(a != b))
      }
      (BinaryOp::Gt, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Bool(a > b)),
      (BinaryOp::GtEq, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Bool(a >= b)),
      (BinaryOp::Lt, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Bool(a < b)),
      (BinaryOp::LtEq, Ok(JsValue::Number(a)), Ok(JsValue::Number(b))) => Ok(JsValue::Bool(a <= b)),
      (BinaryOp::LogicalAnd, Ok(JsValue::Bool(a)), Ok(JsValue::Bool(b))) => {
        Ok(JsValue::Bool(a && b))
      }
      (BinaryOp::LogicalOr, Ok(JsValue::Bool(a)), Ok(JsValue::Bool(b))) => {
        Ok(JsValue::Bool(a || b))
      }
      (BinaryOp::NullishCoalescing, Ok(JsValue::Null | JsValue::Undefined), Ok(b)) => Ok(b),
      (BinaryOp::NullishCoalescing, Ok(a), Ok(_)) => Ok(a),
      _ => Err(bin.span),
    },
    Expr::Unary(unary) => match (unary.op, eval(&*unary.arg)) {
      (UnaryOp::Bang, Ok(JsValue::Bool(v))) => Ok(JsValue::Bool(!v)),
      (UnaryOp::Minus, Ok(JsValue::Number(v))) => Ok(JsValue::Number(-v)),
      (UnaryOp::Plus, Ok(JsValue::Number(v))) => Ok(JsValue::Number(v)),
      (UnaryOp::Plus, Ok(JsValue::String(v))) => {
        if let Ok(v) = v.parse() {
          Ok(JsValue::Number(v))
        } else {
          Err(unary.span)
        }
      }
      (UnaryOp::Tilde, Ok(JsValue::Number(v))) => Ok(JsValue::Number((!(v as i32)) as f64)),
      (UnaryOp::Void, Ok(_)) => Ok(JsValue::Undefined),
      (UnaryOp::TypeOf, Ok(JsValue::Bool(_))) => Ok(JsValue::String("boolean".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::Number(_))) => Ok(JsValue::String("number".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::String(_))) => Ok(JsValue::String("string".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::Object(_))) => Ok(JsValue::String("object".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::Array(_))) => Ok(JsValue::String("object".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::Regex { .. })) => Ok(JsValue::String("object".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::Null)) => Ok(JsValue::String("object".to_string())),
      (UnaryOp::TypeOf, Ok(JsValue::Undefined)) => Ok(JsValue::String("undefined".to_string())),
      _ => Err(unary.span),
    },
    Expr::Ident(id) if &id.sym == "undefined" => Ok(JsValue::Undefined),
    Expr::Cond(cond) => match eval(&*&cond.test) {
      Ok(JsValue::Bool(v)) => {
        if v {
          eval(&*&cond.cons)
        } else {
          eval(&*cond.alt)
        }
      }
      Ok(JsValue::Null) | Ok(JsValue::Undefined) => eval(&*cond.alt),
      Ok(JsValue::Object(_))
      | Ok(JsValue::Array(_))
      | Ok(JsValue::Function(_))
      | Ok(JsValue::Regex { .. }) => eval(&*cond.cons),
      Ok(JsValue::String(s)) => {
        if s.is_empty() {
          eval(&*cond.alt)
        } else {
          eval(&*cond.cons)
        }
      }
      Ok(JsValue::Number(n)) => {
        if n == 0.0 {
          eval(&*cond.alt)
        } else {
          eval(&*cond.cons)
        }
      }
      Err(e) => Err(e),
    },
    Expr::Fn(FnExpr { function, .. }) => Err(function.span),
    Expr::Class(ClassExpr { class, .. }) => Err(class.span),
    Expr::JSXElement(el) => Err(el.span),
    Expr::This(ThisExpr { span, .. })
    | Expr::Update(UpdateExpr { span, .. })
    | Expr::Assign(AssignExpr { span, .. })
    | Expr::Member(MemberExpr { span, .. })
    | Expr::Call(CallExpr { span, .. })
    | Expr::New(NewExpr { span, .. })
    | Expr::Seq(SeqExpr { span, .. })
    | Expr::TaggedTpl(TaggedTpl { span, .. })
    | Expr::Arrow(ArrowExpr { span, .. })
    | Expr::Yield(YieldExpr { span, .. })
    | Expr::Await(AwaitExpr { span, .. })
    | Expr::JSXFragment(JSXFragment { span, .. })
    | Expr::PrivateName(PrivateName { span, .. })
    | Expr::OptChain(OptChainExpr { span, .. })
    | Expr::Ident(Ident { span, .. }) => Err(*span),
    _ => Err(DUMMY_SP),
  }
}

// Convert JS value to AST.
impl TryFrom<JsValue> for Expr {
  type Error = Diagnostic;

  fn try_from(value: JsValue) -> Result<Self, Self::Error> {
    Ok(match value {
      JsValue::Null => Expr::Lit(Lit::Null(Null::dummy())),
      JsValue::Undefined => Expr::Ident(Ident::new(js_word!("undefined"), DUMMY_SP)),
      JsValue::Bool(b) => Expr::Lit(Lit::Bool(Bool {
        value: b,
        span: DUMMY_SP,
      })),
      JsValue::Number(n) => Expr::Lit(Lit::Num(Number {
        value: n,
        span: DUMMY_SP,
        raw: None,
      })),
      JsValue::String(s) => Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: s.into(),
        raw: None,
      })),
      JsValue::Regex { source, flags } => Expr::Lit(Lit::Regex(Regex {
        span: DUMMY_SP,
        exp: source.into(),
        flags: flags.into(),
      })),
      JsValue::Array(arr) => Expr::Array(ArrayLit {
        span: DUMMY_SP,
        elems: arr
          .into_iter()
          .map(|elem| -> Result<_, Self::Error> {
            Ok(Some(ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::try_from(elem)?),
            }))
          })
          .collect::<Result<Vec<_>, Self::Error>>()?,
      }),
      JsValue::Object(obj) => Expr::Object(ObjectLit {
        span: DUMMY_SP,
        props: obj
          .into_iter()
          .map(|(k, v)| -> Result<_, Self::Error> {
            Ok(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
              key: if Ident::verify_symbol(&k).is_ok() {
                PropName::Ident(Ident::new(k.into(), DUMMY_SP))
              } else {
                PropName::Str(Str {
                  value: k.into(),
                  span: DUMMY_SP,
                  raw: None,
                })
              },
              value: Box::new(Expr::try_from(v)?),
            }))))
          })
          .collect::<Result<Vec<_>, Self::Error>>()?,
      }),
      JsValue::Function(source) => {
        let source_map = Lrc::new(SourceMap::default());
        let source_file =
          source_map.new_source_file(swc_core::common::FileName::Anon, source.into());
        let lexer = Lexer::new(
          Default::default(),
          Default::default(),
          StringInput::from(&*source_file),
          None,
        );

        let mut parser = Parser::new_from(lexer);
        match parser.parse_expr() {
          Ok(expr) => *expr,
          Err(err) => {
            let error_buffer = ErrorBuffer::default();
            let handler = Handler::with_emitter(true, false, Box::new(error_buffer.clone()));
            err.into_diagnostic(&handler).emit();
            let mut diagnostics = error_buffer_to_diagnostics(&error_buffer, &source_map);
            return Err(diagnostics.pop().unwrap());
          }
        }
      }
    })
  }
}
