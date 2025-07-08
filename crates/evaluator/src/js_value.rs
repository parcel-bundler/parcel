use std::rc::Rc;

use num_bigint::BigInt;
use num_traits::Zero;
use swc_core::{
  common::{util::take::Take, Span, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::{string::StringObject, Function, JsArray, Object};

/// A type that represents a basic JS value.
#[derive(Clone)]
// #[serde(untagged)]
pub enum JsValue {
  Unknown(Span),
  Undefined,
  Null,
  Bool(bool),
  Number(f64),
  String(JsWord),
  BigInt(BigInt),
  Regex { source: JsWord, flags: JsWord },
  Object(StaticOrRc<dyn Object>),
  Function(StaticOrRc<dyn Function>),
}

pub enum StaticOrRc<T: ?Sized + 'static> {
  Static(&'static T),
  Rc(Rc<T>),
}

impl<T: ?Sized> std::ops::Deref for StaticOrRc<T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    match self {
      StaticOrRc::Static(s) => s,
      StaticOrRc::Rc(rc) => rc,
    }
  }
}

impl<T: ?Sized + 'static> Clone for StaticOrRc<T> {
  fn clone(&self) -> Self {
    match self {
      StaticOrRc::Static(s) => StaticOrRc::Static(s),
      StaticOrRc::Rc(rc) => StaticOrRc::Rc(rc.clone()),
    }
  }
}

impl<T: Object> From<Rc<T>> for StaticOrRc<dyn Object> {
  fn from(value: Rc<T>) -> Self {
    StaticOrRc::Rc(value)
  }
}

impl<T: Function> From<Rc<T>> for StaticOrRc<dyn Function> {
  fn from(value: Rc<T>) -> Self {
    StaticOrRc::Rc(value)
  }
}

impl<T: Object> From<&'static T> for StaticOrRc<dyn Object> {
  fn from(value: &'static T) -> Self {
    StaticOrRc::Static(value)
  }
}

impl<T: Function> From<&'static T> for StaticOrRc<dyn Function> {
  fn from(value: &'static T) -> Self {
    StaticOrRc::Static(value)
  }
}

impl JsValue {
  pub fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match self {
      JsValue::Object(obj) => obj.get(prop, span),
      JsValue::Function(obj) => obj.get(prop, span),
      JsValue::String(s) => StringObject::from(s.clone()).get(prop, span),
      _ => JsValue::Unknown(span),
    }
  }

  pub fn has(&self, prop: &JsValue, span: Span) -> JsValue {
    match self {
      JsValue::Object(obj) => JsValue::Bool(obj.has(prop)),
      JsValue::Function(obj) => JsValue::Bool(obj.has(prop)),
      _ => JsValue::Unknown(span),
    }
  }

  pub fn values<'a>(&'a self) -> Option<Box<dyn Iterator<Item = JsValue> + 'a>> {
    match self {
      JsValue::Object(obj) => obj.values(),
      JsValue::String(s) => Some(Box::new(
        s.chars().map(|c| JsValue::String(c.to_string().into())),
      )),
      _ => None,
    }
  }

  pub fn is_known(&self) -> bool {
    !matches!(self, JsValue::Unknown(..))
  }

  pub fn type_of(&self, span: Span) -> JsValue {
    use JsValue::*;
    JsValue::String(
      match self {
        Unknown(..) => return JsValue::Unknown(span),
        Undefined => "undefined",
        Null => "object",
        Bool(..) => "boolean",
        Number(..) => "number",
        BigInt(..) => "bigint",
        String(..) => "string",
        Regex { .. } => "object",
        Object(..) => "object",
        Function(..) => "function",
      }
      .into(),
    )
  }

  pub fn coerse_to_bool(&self) -> Option<bool> {
    use JsValue::*;
    match self {
      Unknown(..) => None,
      Undefined => Some(false),
      Null => Some(false),
      Bool(b) => Some(*b),
      Number(v) => Some(*v != 0.0),
      BigInt(v) => Some(!v.is_zero()),
      String(s) => Some(!s.is_empty()),
      Regex { .. } => Some(true),
      Object(..) => Some(true),
      Function(..) => Some(true),
    }
  }

  pub fn to_string(&self) -> JsWord {
    match self {
      JsValue::Unknown(..) => "unknown".into(),
      JsValue::Undefined => "undefined".into(),
      JsValue::Null => "null".into(),
      JsValue::Bool(value) => value.to_string().into(),
      JsValue::Number(value) => value.to_string().into(),
      JsValue::String(atom) => atom.clone(),
      JsValue::BigInt(big_int) => big_int.to_string().into(),
      JsValue::Regex { source, flags } => format!("/{}/{}", source, flags).into(),
      JsValue::Object(obj) => obj.to_string(),
      JsValue::Function(_) => "function () { [native code] }".into(),
    }
  }

  pub fn is_strictly_equal(&self, other: &JsValue) -> Option<bool> {
    // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-isstrictlyequal
    use JsValue::*;
    Some(match (self, other) {
      (Undefined, Undefined) => true,
      (Null, Null) => true,
      (Bool(a), Bool(b)) => *a == *b,
      (Number(a), Number(b)) => *a == *b,
      (BigInt(a), BigInt(b)) => *a == *b,
      (String(a), String(b)) => *a == *b,
      _ => return None,
    })
  }

  pub fn is_loosely_equal(&self, other: &JsValue) -> Option<bool> {
    // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-islooselyequal
    use JsValue::*;
    self.is_strictly_equal(other).or_else(|| {
      Some(match (self, other) {
        (Null, Undefined) => true,
        (Undefined, Null) => true,
        // TODO
        // (Number(a), String(b)) =>
        _ => return None,
      })
    })
  }

  /// Convert JS value to AST.
  pub fn into_expr(&self) -> Result<Expr, ()> {
    Ok(match self {
      JsValue::Null => Expr::Lit(Lit::Null(Null::dummy())),
      JsValue::Undefined => Expr::Unary(UnaryExpr {
        span: DUMMY_SP,
        op: UnaryOp::Void,
        arg: 0.into(),
      }),
      JsValue::Bool(b) => (*b).into(),
      JsValue::Number(n) => (*n).into(),
      JsValue::BigInt(n) => n.clone().into(),
      JsValue::String(s) => s.clone().into(),
      JsValue::Regex { source, flags } => Expr::Lit(Lit::Regex(Regex {
        span: DUMMY_SP,
        exp: source.clone().into(),
        flags: flags.clone().into(),
      })),
      JsValue::Object(obj) => obj.into_expr()?,
      JsValue::Function(f) => f.into_expr()?,
      // JsValue::Function(source) => {
      //   let source_file = self
      //     .source_map
      //     .new_source_file(swc_core::common::FileName::MacroExpansion, source.into());
      //   let lexer = Lexer::new(
      //     Default::default(),
      //     Default::default(),
      //     StringInput::from(&*source_file),
      //     None,
      //   );

      //   let mut parser = Parser::new_from(lexer);
      //   match parser.parse_expr() {
      //     Ok(expr) => *expr,
      //     Err(err) => return Err(MacroError::ParseError(err)),
      //   }
      // }
      _ => return Err(()),
    })
  }

  pub fn update_expr(&self, expr: &mut Expr) -> Result<(), ()> {
    match self {
      JsValue::Object(obj) => obj.update_expr(expr),
      _ => {
        if let Ok(res) = self.into_expr() {
          *expr = res;
          Ok(())
        } else {
          Err(())
        }
      }
    }
  }
}

impl PartialEq<JsValue> for JsValue {
  fn eq(&self, other: &JsValue) -> bool {
    return self.is_strictly_equal(other) == Some(true);
  }
}

impl std::fmt::Display for JsValue {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      JsValue::Unknown(_) => f.write_str("unknown"),
      JsValue::Undefined => f.write_str("undefined"),
      JsValue::Null => f.write_str("null"),
      JsValue::Bool(b) => write!(f, "{}", b),
      JsValue::Number(n) => write!(f, "{}", n),
      JsValue::BigInt(n) => write!(f, "{}n", n),
      JsValue::String(s) => write!(f, "{:?}", s),
      JsValue::Regex { source, flags } => write!(f, "/{}/{}", source, flags),
      JsValue::Object(obj) => {
        if let Some(arr) = obj.as_any().downcast_ref::<JsArray>() {
          f.write_str("[")?;
          for (index, v) in arr.values().unwrap().enumerate() {
            if index > 0 {
              f.write_str(", ")?;
            }
            write!(f, "{}", v)?;
          }
          f.write_str("]")
        } else {
          f.write_str("{")?;
          for (index, (k, v)) in obj.entries().enumerate() {
            if index > 0 {
              f.write_str(", ")?;
            }
            write!(f, "{}: {}", k, v)?
          }
          f.write_str("}")
        }
      }
      JsValue::Function(_) => write!(f, "function"),
    }
  }
}
