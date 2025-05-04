use std::{
  collections::{HashMap, HashSet},
  rc::Rc,
};

use as_any::AsAny;
use indexmap::IndexMap;
use itertools::Itertools;
use num_bigint::{BigInt, Sign};
use num_traits::{Pow, ToPrimitive, Zero};
use swc_core::{
  common::{util::take::Take, Span, Spanned, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

// 1. Build value graph, collect constants.
// 2. Remove known dead branches, evaluate macros and dependencies.
// 3. Link dependencies.
// 4. Re-evaluate constants with linked deps.
// 5. Eliminate dead code.

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
  Array(Rc<Vec<JsValue>>),
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

pub trait Function: Object {
  #[allow(unused)]
  fn call(&self, this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    JsValue::Unknown(span)
  }

  #[allow(unused)]
  fn construct(&self, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    JsValue::Unknown(span)
  }
}

impl<T: 'static> Object for T where T: Fn(JsValue, Vec<JsValue>, Span, &Evaluator) -> JsValue {}
impl<T: 'static> Function for T
where
  T: Fn(JsValue, Vec<JsValue>, Span, &Evaluator) -> JsValue,
{
  fn call(&self, this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
    self(this, args, span, evaluator)
  }
}

pub trait Object: AsAny {
  #[allow(unused)]
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    JsValue::Unknown(span)
  }

  #[allow(unused)]
  fn has(&self, prop: &JsValue) -> bool {
    false
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    Box::new(std::iter::empty())
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Err(())
  }
}

impl Object for IndexMap<JsWord, JsValue> {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    self
      .get(&prop.to_string())
      .cloned()
      .unwrap_or(JsValue::Unknown(span))
  }

  fn has(&self, prop: &JsValue) -> bool {
    self.contains_key(&prop.to_string())
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    Box::new(self.iter().map(|(k, v)| (k.clone(), v.clone())))
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Ok(Expr::Object(ObjectLit {
      span: DUMMY_SP,
      props: {
        let mut props = Vec::new();
        for (k, v) in self.iter() {
          props.push(PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
            key: if Ident::verify_symbol(&k).is_ok() {
              PropName::Ident(IdentName::new(k.clone().into(), DUMMY_SP))
            } else {
              PropName::Str(Str {
                value: k.clone().into(),
                span: DUMMY_SP,
                raw: None,
              })
            },
            value: Box::new(v.clone().into_expr()?),
          }))));
        }

        props
      },
    }))
  }
}

impl Object for phf::OrderedMap<&'static str, JsValue> {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    self
      .get(&prop.to_string())
      .cloned()
      .unwrap_or(JsValue::Unknown(span))
  }

  fn has(&self, prop: &JsValue) -> bool {
    self.contains_key(&prop.to_string())
  }

  fn iter<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    Box::new(self.into_iter().map(|(k, v)| ((*k).into(), v.clone())))
  }
}

#[macro_export]
macro_rules! builtin_object {
  ($($v: tt)*) => {
    JsValue::Object(StaticOrRc::Static(&phf::phf_ordered_map! {
      $($v)*
    }))
  };
}

impl JsValue {
  pub fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match self {
      JsValue::Array(arr) => match prop {
        JsValue::Number(n) => arr
          .get(*n as usize)
          .cloned()
          .unwrap_or(JsValue::Unknown(span)),
        JsValue::String(s) if s == "length" => JsValue::Number(arr.len() as f64),
        _ => JsValue::Unknown(span),
      },
      JsValue::Object(obj) => obj.get(prop, span),
      JsValue::Function(obj) => obj.get(prop, span),
      JsValue::String(s) => match prop {
        JsValue::Number(n) => s
          .get(*n as usize..=*n as usize)
          .map(|c| JsValue::String(c.into()))
          .unwrap_or(JsValue::Unknown(span)),
        JsValue::String(name) if name == "length" => JsValue::Number(s.len() as f64),
        _ => JsValue::Unknown(span),
      },
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

  pub fn get_index(&self, index: usize) -> Option<JsValue> {
    if let JsValue::Array(arr) = self {
      arr.get(index).cloned()
    } else {
      None
    }
  }

  pub fn rest(&self, index: usize) -> Option<JsValue> {
    if let JsValue::Array(arr) = self {
      arr
        .get(index..)
        .map(|s| JsValue::Array(Rc::new(s.to_vec())))
    } else {
      None
    }
  }

  fn is_known(&self) -> bool {
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
        Array(..) => "object",
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
      Array(..) => Some(true),
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
      JsValue::Array(js_values) => js_values.iter().map(|i| i.to_string()).join(",").into(),
      JsValue::Object(_) => "[object Object]".into(),
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
}

impl PartialEq<JsValue> for JsValue {
  fn eq(&self, other: &JsValue) -> bool {
    return self.is_strictly_equal(other) == Some(true);
  }
}

pub struct JsFunction {
  params: Vec<Pat>,
  expr: Expr,
}

impl Object for JsFunction {}
impl Function for JsFunction {
  fn call(&self, this: JsValue, args: Vec<JsValue>, _span: Span, parent: &Evaluator) -> JsValue {
    let mut evaluator = Evaluator::new();
    evaluator.this = this;
    evaluator.parent = Some(parent);

    for (pat, arg) in self.params.iter().zip(args.into_iter()) {
      evaluator.eval_pat(arg, pat, &mut Evaluator::add_value);
    }

    self.expr.evaluate(&evaluator)
  }
}

pub trait Evaluate {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue;
}

impl Evaluate for Expr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self {
      Expr::Array(array_lit) => array_lit.evaluate(evaluator),
      Expr::Object(object_lit) => object_lit.evaluate(evaluator),
      Expr::Unary(unary_expr) => unary_expr.evaluate(evaluator),
      Expr::Bin(bin_expr) => bin_expr.evaluate(evaluator),
      Expr::Member(member_expr) => member_expr.evaluate(evaluator),
      Expr::OptChain(opt_chain_expr) => opt_chain_expr.evaluate(evaluator),
      Expr::MetaProp(meta_prop_expr) => meta_prop_expr.evaluate(evaluator),
      Expr::Cond(cond_expr) => cond_expr.evaluate(evaluator),
      Expr::Seq(seq_expr) => seq_expr.evaluate(evaluator),
      Expr::Ident(ident) => ident.evaluate(evaluator),
      Expr::This(this_expr) => this_expr.evaluate(evaluator),
      Expr::Lit(lit) => lit.evaluate(evaluator),
      Expr::Tpl(tpl) => tpl.evaluate(evaluator),
      Expr::Paren(paren_expr) => paren_expr.evaluate(evaluator),
      Expr::Call(call_expr) => call_expr.evaluate(evaluator),
      Expr::New(new_expr) => new_expr.evaluate(evaluator),
      Expr::Fn(fn_expr) => fn_expr.evaluate(evaluator),
      Expr::Arrow(arrow_expr) => arrow_expr.evaluate(evaluator),
      Expr::Class(class_expr) => JsValue::Unknown(class_expr.class.span),
      Expr::TaggedTpl(tagged_tpl) => JsValue::Unknown(tagged_tpl.span),
      Expr::Update(update_expr) => JsValue::Unknown(update_expr.span),
      Expr::Assign(assign_expr) => JsValue::Unknown(assign_expr.span),
      Expr::SuperProp(super_prop_expr) => JsValue::Unknown(super_prop_expr.span),
      Expr::Yield(yield_expr) => JsValue::Unknown(yield_expr.span),
      Expr::Await(await_expr) => JsValue::Unknown(await_expr.span),
      Expr::JSXMember(jsxmember_expr) => JsValue::Unknown(jsxmember_expr.span),
      Expr::JSXNamespacedName(jsxnamespaced_name) => JsValue::Unknown(jsxnamespaced_name.span),
      Expr::JSXEmpty(jsxempty_expr) => JsValue::Unknown(jsxempty_expr.span),
      Expr::JSXElement(jsxelement) => JsValue::Unknown(jsxelement.span),
      Expr::JSXFragment(jsxfragment) => JsValue::Unknown(jsxfragment.span),
      Expr::TsTypeAssertion(ts_type_assertion) => JsValue::Unknown(ts_type_assertion.span),
      Expr::TsConstAssertion(ts_const_assertion) => JsValue::Unknown(ts_const_assertion.span),
      Expr::TsNonNull(ts_non_null_expr) => JsValue::Unknown(ts_non_null_expr.span),
      Expr::TsAs(ts_as_expr) => JsValue::Unknown(ts_as_expr.span),
      Expr::TsInstantiation(ts_instantiation) => JsValue::Unknown(ts_instantiation.span),
      Expr::TsSatisfies(ts_satisfies_expr) => JsValue::Unknown(ts_satisfies_expr.span),
      Expr::PrivateName(private_name) => JsValue::Unknown(private_name.span),
      Expr::Invalid(invalid) => JsValue::Unknown(invalid.span),
    }
  }
}

impl Evaluate for Ident {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    evaluator
      .get(self.to_id())
      .unwrap_or(JsValue::Unknown(self.span))
  }
}

impl Evaluate for ThisExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    evaluator.this.clone()
  }
}

impl Evaluate for MetaPropExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self.kind {
      MetaPropKind::ImportMeta => evaluator.import_meta.clone(),
      MetaPropKind::NewTarget => JsValue::Unknown(self.span),
    }
  }
}

impl Evaluate for Lit {
  fn evaluate(&self, _evaluator: &Evaluator) -> JsValue {
    match self {
      Lit::Null(_) => JsValue::Null,
      Lit::Bool(v) => JsValue::Bool(v.value),
      Lit::Num(v) => JsValue::Number(v.value),
      Lit::Str(v) => JsValue::String(v.value.clone()),
      Lit::JSXText(v) => JsValue::String(v.value.clone()),
      Lit::Regex(v) => JsValue::Regex {
        source: v.exp.clone(),
        flags: v.flags.clone(),
      },
      Lit::BigInt(v) => JsValue::BigInt((*v.value).clone()),
    }
  }
}

impl Evaluate for Tpl {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let exprs: Vec<_> = self
      .exprs
      .iter()
      .map(|expr| expr.evaluate(evaluator))
      .collect();
    if exprs.len() == self.exprs.len() {
      let mut res = String::new();
      let mut expr_iter = exprs.iter();
      for quasi in &self.quasis {
        res.push_str(&quasi.raw);
        match expr_iter.next() {
          None => {}
          Some(JsValue::String(s)) => res.push_str(s),
          Some(JsValue::Number(n)) => res.push_str(&n.to_string()),
          Some(JsValue::Bool(b)) => res.push_str(&b.to_string()),
          _ => return JsValue::Unknown(self.span),
        }
      }

      JsValue::String(res.into())
    } else {
      JsValue::Unknown(self.span)
    }
  }
}

impl Evaluate for ArrayLit {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let mut res = Vec::with_capacity(self.elems.len());
    for elem in &self.elems {
      if let Some(elem) = elem {
        let val = elem.expr.evaluate(evaluator);
        if elem.spread.is_some() {
          match val {
            JsValue::Array(arr) => {
              res.extend(arr.iter().cloned());
            }
            _ => return JsValue::Unknown(self.span),
          }
        } else if val.is_known() {
          res.push(val);
        } else {
          return val;
        }
      } else {
        res.push(JsValue::Undefined);
      }
    }
    JsValue::Array(Rc::new(res))
  }
}

impl Evaluate for ObjectLit {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let mut res = IndexMap::with_capacity(self.props.len());
    for prop in &self.props {
      match prop {
        PropOrSpread::Prop(prop) => match &**prop {
          Prop::KeyValue(kv) => {
            let k = kv.key.evaluate(evaluator);
            if k.is_known() {
              let v = kv.value.evaluate(evaluator);
              if v.is_known() {
                res.insert(k.to_string(), v);
              } else {
                return v;
              }
            } else {
              return k;
            }
          }
          Prop::Shorthand(s) => {
            let val = s.evaluate(evaluator);
            if val.is_known() {
              res.insert(s.sym.clone(), val);
            } else {
              return val;
            }
          }
          Prop::Method(method) => {
            let k = method.key.evaluate(evaluator);
            let f = method.function.evaluate(evaluator);
            if k.is_known() && f.is_known() {
              res.insert(k.to_string(), f);
            } else {
              return JsValue::Unknown(method.span());
            }
          }
          _ => return JsValue::Unknown(self.span),
        },
        PropOrSpread::Spread(spread) => {
          let v = spread.expr.evaluate(evaluator);
          match v {
            JsValue::Object(o) => res.extend(o.iter()),
            _ => return JsValue::Unknown(self.span),
          }
        }
      }
    }
    JsValue::Object(Rc::new(res).into())
  }
}

impl Evaluate for PropName {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self {
      PropName::Ident(IdentName { sym, .. }) | PropName::Str(Str { value: sym, .. }) => {
        JsValue::String(sym.clone())
      }
      PropName::Num(n) => JsValue::Number(n.value),
      PropName::Computed(c) => c.expr.evaluate(evaluator),
      PropName::BigInt(v) => JsValue::BigInt((*v.value).clone()),
    }
  }
}

impl Evaluate for BinExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match (
      self.op,
      self.left.evaluate(evaluator),
      self.right.evaluate(evaluator),
    ) {
      (BinaryOp::Add, JsValue::String(a), JsValue::String(b)) => {
        JsValue::String(format!("{}{}", a, b).into())
      }
      (BinaryOp::Add, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a + b),
      (BinaryOp::Add, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a + b),
      (BinaryOp::Add, JsValue::String(a), JsValue::Number(b)) => {
        JsValue::String(format!("{}{}", a, b).into())
      }
      (BinaryOp::Add, JsValue::Number(a), JsValue::String(b)) => {
        JsValue::String(format!("{}{}", a, b).into())
      }
      (BinaryOp::BitAnd, JsValue::Number(a), JsValue::Number(b)) => {
        JsValue::Number(((a as i32) & (b as i32)) as f64)
      }
      (BinaryOp::BitAnd, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a & b),
      (BinaryOp::BitOr, JsValue::Number(a), JsValue::Number(b)) => {
        JsValue::Number(((a as i32) | (b as i32)) as f64)
      }
      (BinaryOp::BitOr, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a | b),
      (BinaryOp::BitXor, JsValue::Number(a), JsValue::Number(b)) => {
        JsValue::Number(((a as i32) ^ (b as i32)) as f64)
      }
      (BinaryOp::BitXor, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a ^ b),
      (BinaryOp::LShift, JsValue::Number(a), JsValue::Number(b)) => {
        JsValue::Number(((a as i32) << (b as i32)) as f64)
      }
      (BinaryOp::LShift, JsValue::BigInt(a), JsValue::BigInt(b)) => {
        if let Some(b) = b.to_i128() {
          JsValue::BigInt(a << b)
        } else {
          JsValue::Unknown(self.span)
        }
      }
      (BinaryOp::RShift, JsValue::Number(a), JsValue::Number(b)) => {
        JsValue::Number(((a as i32) >> (b as i32)) as f64)
      }
      (BinaryOp::RShift, JsValue::BigInt(a), JsValue::BigInt(b)) => {
        if let Some(b) = b.to_i128() {
          JsValue::BigInt(a >> b)
        } else {
          JsValue::Unknown(self.span)
        }
      }
      (BinaryOp::ZeroFillRShift, JsValue::Number(a), JsValue::Number(b)) => {
        JsValue::Number(((a as i32) >> (b as u32)) as f64)
      }
      (BinaryOp::Sub, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a - b),
      (BinaryOp::Sub, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a - b),
      (BinaryOp::Div, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a / b),
      (BinaryOp::Div, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a / b),
      (BinaryOp::Mul, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a * b),
      (BinaryOp::Mul, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a * b),
      (BinaryOp::Mod, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a % b),
      (BinaryOp::Mod, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a % b),
      (BinaryOp::Exp, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a.powf(b)),
      (BinaryOp::Exp, JsValue::BigInt(a), JsValue::BigInt(b)) => {
        if b.sign() == Sign::Minus {
          JsValue::Unknown(self.span)
        } else {
          JsValue::BigInt(a.pow(b.magnitude()))
        }
      }
      (BinaryOp::EqEq, a, b) => a
        .is_loosely_equal(&b)
        .map(JsValue::Bool)
        .unwrap_or(JsValue::Unknown(self.span)),
      (BinaryOp::NotEq, a, b) => a
        .is_loosely_equal(&b)
        .map(|b| JsValue::Bool(!b))
        .unwrap_or(JsValue::Unknown(self.span)),
      (BinaryOp::EqEqEq, a, b) => a
        .is_strictly_equal(&b)
        .map(JsValue::Bool)
        .unwrap_or(JsValue::Unknown(self.span)),
      (BinaryOp::NotEqEq, a, b) => a
        .is_strictly_equal(&b)
        .map(|b| JsValue::Bool(!b))
        .unwrap_or(JsValue::Unknown(self.span)),
      (BinaryOp::Gt, JsValue::Number(a), JsValue::Number(b)) => JsValue::Bool(a > b),
      (BinaryOp::Gt, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::Bool(a > b),
      (BinaryOp::GtEq, JsValue::Number(a), JsValue::Number(b)) => JsValue::Bool(a >= b),
      (BinaryOp::GtEq, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::Bool(a >= b),
      (BinaryOp::Lt, JsValue::Number(a), JsValue::Number(b)) => JsValue::Bool(a < b),
      (BinaryOp::Lt, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::Bool(a < b),
      (BinaryOp::LtEq, JsValue::Number(a), JsValue::Number(b)) => JsValue::Bool(a <= b),
      (BinaryOp::LtEq, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::Bool(a <= b),
      (BinaryOp::LogicalAnd, a, b) => {
        if let (Some(a_bool), Some(_)) = (a.coerse_to_bool(), b.coerse_to_bool()) {
          if a_bool {
            b
          } else {
            a
          }
        } else {
          JsValue::Unknown(self.span)
        }
      }
      (BinaryOp::LogicalOr, a, b) => {
        if let (Some(a_bool), Some(_)) = (a.coerse_to_bool(), b.coerse_to_bool()) {
          if a_bool {
            a
          } else {
            b
          }
        } else {
          JsValue::Unknown(self.span)
        }
      }
      (BinaryOp::NullishCoalescing, JsValue::Null | JsValue::Undefined, b) => b,
      (BinaryOp::NullishCoalescing, a, _) => a,
      (BinaryOp::In, prop, value) => value.has(&prop, self.span),
      _ => JsValue::Unknown(self.span),
    }
  }
}

impl Evaluate for UnaryExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match (self.op, self.arg.evaluate(evaluator)) {
      (UnaryOp::Bang, v) => v
        .coerse_to_bool()
        .map(|v| JsValue::Bool(!v))
        .unwrap_or(JsValue::Unknown(self.span)),
      (UnaryOp::Minus, JsValue::Number(v)) => JsValue::Number(-v),
      (UnaryOp::Minus, JsValue::BigInt(v)) => JsValue::BigInt(-v),
      (UnaryOp::Plus, JsValue::Number(v)) => JsValue::Number(v),
      (UnaryOp::Plus, JsValue::String(v)) => {
        if let Ok(v) = v.parse() {
          JsValue::Number(v)
        } else {
          JsValue::Unknown(self.span)
        }
      }
      (UnaryOp::Tilde, JsValue::Number(v)) => JsValue::Number((!(v as i32)) as f64),
      (UnaryOp::Tilde, JsValue::BigInt(v)) => JsValue::BigInt(!v),
      (UnaryOp::Void, arg) => {
        if arg.is_known() {
          JsValue::Undefined
        } else {
          // Mark as unknown in case argument has side effects.
          // TODO: check this
          JsValue::Unknown(self.span)
        }
      }
      (UnaryOp::TypeOf, value) => value.type_of(self.span),
      _ => JsValue::Unknown(self.span),
    }
  }
}

impl Evaluate for CondExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self.test.evaluate(evaluator).coerse_to_bool() {
      Some(true) => self.cons.evaluate(evaluator),
      Some(false) => self.alt.evaluate(evaluator),
      None => JsValue::Unknown(self.span),
    }
  }
}

impl Evaluate for MemberExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let obj = self.obj.evaluate(evaluator);
    let prop = self.prop.evaluate(evaluator);
    obj.get(&prop, self.span)
  }
}

impl Evaluate for MemberProp {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self {
      MemberProp::Ident(id) => JsValue::String(id.sym.clone()),
      MemberProp::Computed(prop) => prop.expr.evaluate(evaluator),
      MemberProp::PrivateName(p) => JsValue::Unknown(p.span),
    }
  }
}

impl Evaluate for OptChainBase {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self {
      OptChainBase::Call(call) => match call.callee.evaluate(evaluator) {
        JsValue::Undefined | JsValue::Null => JsValue::Undefined,
        JsValue::Function(callee) => {
          let this = JsValue::Undefined;
          let args = eval_args(&call.args, evaluator);
          callee.call(this, args, call.span, evaluator)
        }
        _ => JsValue::Unknown(call.span),
      },
      OptChainBase::Member(member) => {
        let base = member.obj.evaluate(evaluator);
        match base {
          JsValue::Unknown(span) => JsValue::Unknown(span),
          JsValue::Undefined | JsValue::Null => JsValue::Undefined,
          _ => {
            let prop = member.prop.evaluate(evaluator);
            base.get(&prop, member.span)
          }
        }
      }
    }
  }
}

impl Evaluate for OptChainExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.base.evaluate(evaluator)
  }
}

impl Evaluate for SeqExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let mut last = JsValue::Unknown(self.span);
    for expr in self.exprs.iter() {
      last = expr.evaluate(evaluator);
      if !last.is_known() {
        return last;
      }
    }

    last
  }
}

impl Evaluate for ParenExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}

impl Evaluate for CallExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match &self.callee {
      Callee::Expr(callee) => {
        let (this, callee) = if let Expr::Member(member) = &**callee {
          let this = member.obj.evaluate(evaluator);
          let prop = member.prop.evaluate(evaluator);
          let callee = this.get(&prop, member.span);
          (this, callee)
        } else {
          let this = JsValue::Undefined;
          let callee = callee.evaluate(evaluator);
          (this, callee)
        };
        match callee {
          JsValue::Function(callee) => {
            let args = eval_args(&self.args, evaluator);
            callee.call(this, args, self.span, evaluator)
          }
          _ => JsValue::Unknown(self.span),
        }
      }
      Callee::Super(s) => JsValue::Unknown(s.span),
      Callee::Import(_) => {
        if let JsValue::Function(callee) = &evaluator.dynamic_import {
          let args = eval_args(&self.args, evaluator);
          callee.call(JsValue::Undefined, args, self.span, evaluator)
        } else {
          JsValue::Unknown(self.span)
        }
      }
    }
  }
}

impl Evaluate for Callee {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    match self {
      Callee::Expr(callee) => callee.evaluate(evaluator),
      Callee::Super(s) => JsValue::Unknown(s.span),
      Callee::Import(_) => evaluator.dynamic_import.clone(),
    }
  }
}

impl Evaluate for NewExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let callee = self.callee.evaluate(evaluator);
    match callee {
      JsValue::Function(callee) => {
        let args = if let Some(args) = &self.args {
          eval_args(args, evaluator)
        } else {
          Vec::new()
        };
        callee.construct(args, self.span, evaluator)
      }
      _ => JsValue::Unknown(self.span),
    }
  }
}

fn eval_args<'a>(args: &'a Vec<ExprOrSpread>, evaluator: &'a Evaluator) -> Vec<JsValue> {
  use itertools::Either::*;
  args
    .iter()
    .flat_map(|arg| {
      let value = arg.expr.evaluate(evaluator);
      if let Some(span) = arg.spread {
        Left(if let JsValue::Array(arr) = value {
          Left((*arr).clone().into_iter())
        } else {
          Right(std::iter::once(JsValue::Unknown(span)))
        })
      } else {
        Right(std::iter::once(value))
      }
    })
    .collect()
}

impl Evaluate for swc_core::ecma::ast::Function {
  fn evaluate(&self, _evaluator: &Evaluator) -> JsValue {
    if self.is_async || self.is_generator || !self.decorators.is_empty() {
      return JsValue::Unknown(self.span);
    }

    if let Some(body) = &self.body {
      if body.stmts.len() == 1 {
        match &body.stmts[0] {
          Stmt::Return(ret) => {
            let mut params = Vec::with_capacity(self.params.len());
            for param in &self.params {
              if !param.decorators.is_empty() {
                return JsValue::Unknown(param.span);
              }

              params.push(param.pat.clone());
            }

            if let Some(arg) = &ret.arg {
              return JsValue::Function(
                Rc::new(JsFunction {
                  params,
                  expr: (**arg).clone(),
                })
                .into(),
              );
            } else {
              return JsValue::Function(
                Rc::new(JsFunction {
                  params,
                  expr: UnaryExpr {
                    span: ret.span,
                    op: op!("void"),
                    arg: Lit::Num(Number {
                      span: ret.span,
                      value: 0.0,
                      raw: None,
                    })
                    .into(),
                  }
                  .into(),
                })
                .into(),
              );
            }
          }
          Stmt::Expr(expr) => {
            let mut params = Vec::with_capacity(self.params.len());
            for param in &self.params {
              if !param.decorators.is_empty() {
                return JsValue::Unknown(param.span);
              }

              params.push(param.pat.clone());
            }

            return JsValue::Function(
              Rc::new(JsFunction {
                params,
                expr: Expr::Seq(SeqExpr {
                  span: DUMMY_SP,
                  exprs: vec![expr.expr.clone(), Expr::undefined(DUMMY_SP)],
                }),
              })
              .into(),
            );
          }
          _ => {}
        }
      }
    }

    JsValue::Unknown(self.span)
  }
}

impl Evaluate for FnExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.function.evaluate(evaluator)
  }
}

impl Evaluate for ArrowExpr {
  fn evaluate(&self, _evaluator: &Evaluator) -> JsValue {
    if self.is_async || self.is_generator {
      return JsValue::Unknown(self.span);
    }

    match &*self.body {
      BlockStmtOrExpr::BlockStmt(block) => {
        if block.stmts.len() == 1 {
          match &block.stmts[0] {
            Stmt::Return(ret) => {
              if let Some(arg) = &ret.arg {
                return JsValue::Function(
                  Rc::new(JsFunction {
                    params: self.params.clone(),
                    expr: (**arg).clone(),
                  })
                  .into(),
                );
              } else {
                return JsValue::Function(
                  Rc::new(JsFunction {
                    params: self.params.clone(),
                    expr: UnaryExpr {
                      span: ret.span,
                      op: op!("void"),
                      arg: Lit::Num(Number {
                        span: ret.span,
                        value: 0.0,
                        raw: None,
                      })
                      .into(),
                    }
                    .into(),
                  })
                  .into(),
                );
              }
            }
            Stmt::Expr(expr) => {
              return JsValue::Function(
                Rc::new(JsFunction {
                  params: self.params.clone(),
                  expr: Expr::Seq(SeqExpr {
                    span: DUMMY_SP,
                    exprs: vec![expr.expr.clone(), Expr::undefined(DUMMY_SP)],
                  }),
                })
                .into(),
              );
            }
            _ => {}
          }
        }
      }
      BlockStmtOrExpr::Expr(expr) => {
        return JsValue::Function(
          Rc::new(JsFunction {
            params: self.params.clone(),
            expr: (**expr).clone(),
          })
          .into(),
        );
      }
    }

    JsValue::Unknown(self.span)
  }
}

pub struct Evaluator<'a> {
  values: HashMap<Id, JsValue>,
  pub import_meta: JsValue,
  pub dynamic_import: JsValue,
  pub this: JsValue,
  pub parent: Option<&'a Evaluator<'a>>,
}

impl<'a> Evaluator<'a> {
  pub fn new() -> Evaluator<'a> {
    Evaluator {
      values: HashMap::new(),
      import_meta: JsValue::Unknown(DUMMY_SP),
      dynamic_import: JsValue::Unknown(DUMMY_SP),
      this: JsValue::Unknown(DUMMY_SP),
      parent: None,
    }
  }

  pub fn get(&self, id: Id) -> Option<JsValue> {
    self
      .values
      .get(&id)
      .cloned()
      .or_else(|| self.parent.as_ref().and_then(|p| p.get(id)))
  }

  pub fn add_value(&mut self, id: Id, value: JsValue) {
    self.values.entry(id).or_insert(value);
  }

  pub fn eval_pat<F: FnMut(&mut Self, Id, JsValue)>(
    &mut self,
    value: JsValue,
    pat: &Pat,
    add_value: &mut F,
  ) {
    match pat {
      Pat::Ident(name) => {
        add_value(self, name.to_id(), value);
      }
      Pat::Array(arr) => {
        self.eval_array_pat(value, arr, add_value);
      }
      Pat::Object(obj) => {
        self.eval_object_pat(value, obj, add_value);
      }
      _ => {}
    }
  }

  pub fn eval_array_pat<F: FnMut(&mut Self, Id, JsValue)>(
    &mut self,
    value: JsValue,
    arr: &ArrayPat,
    add_value: &mut F,
  ) {
    for (index, elem) in arr.elems.iter().enumerate() {
      if let Some(elem) = elem {
        match elem {
          Pat::Array(ArrayPat { span, .. })
          | Pat::Object(ObjectPat { span, .. })
          | Pat::Ident(BindingIdent {
            id: Ident { span, .. },
            ..
          }) => self.eval_pat(
            value.get_index(index).unwrap_or(JsValue::Unknown(*span)),
            elem,
            add_value,
          ),
          Pat::Rest(rest) => self.eval_pat(
            value.rest(index).unwrap_or(JsValue::Unknown(rest.span)),
            &*rest.arg,
            add_value,
          ),
          Pat::Assign(assign) => {
            let right = assign.right.evaluate(self);
            self.eval_pat(
              value.get_index(index).unwrap_or(right),
              &*assign.left,
              add_value,
            );
          }
          _ => {}
        }
      }
    }
  }

  pub fn eval_object_pat<F: FnMut(&mut Self, Id, JsValue)>(
    &mut self,
    value: JsValue,
    obj: &ObjectPat,
    add_value: &mut F,
  ) {
    let mut consumed = HashSet::new();
    for prop in &obj.props {
      match prop {
        ObjectPatProp::KeyValue(kv) => {
          let key = kv.key.evaluate(self);
          consumed.insert(key.to_string());
          let val = value.get(&key, kv.span());
          self.eval_pat(val, &*kv.value, add_value)
        }
        ObjectPatProp::Assign(assign) => {
          let mut val = value.get(&JsValue::String(assign.key.sym.clone()), assign.key.span);
          if matches!(val, JsValue::Undefined | JsValue::Null) {
            val = assign
              .value
              .as_ref()
              .map(|v| v.evaluate(self))
              .unwrap_or(JsValue::Unknown(assign.value.span()));
          }

          add_value(self, assign.key.to_id(), val);
          consumed.insert(assign.key.sym.clone());
        }
        ObjectPatProp::Rest(rest) => {
          let val = if let JsValue::Object(obj) = &value {
            let filtered: IndexMap<_, _> = obj
              .iter()
              .filter(|(k, _)| !consumed.contains(&k.as_str().into()))
              .collect();

            JsValue::Object(Rc::new(filtered).into())
          } else {
            JsValue::Unknown(rest.span)
          };
          self.eval_pat(val, &*rest.arg, add_value);
        }
      }
    }
  }

  // pub fn eval_assign_target<F: FnMut(&mut Self, Id, JsValue)>(&self, target: &AssignTarget) {
  //   match target {
  //     AssignTarget::Simple(SimpleAssignTarget::Ident(id)) => {
  //       self.mutate_value(id.to_id(), *span);
  //     }
  //     AssignTarget::Simple(SimpleAssignTarget::Member(member)) => {
  //       // TODO: handle if the setter function mutates the value
  //       self.eval_member_assign(member);
  //     }
  //     AssignTarget::Simple(SimpleAssignTarget::SuperProp(..)) => {}
  //     AssignTarget::Simple(SimpleAssignTarget::Paren(paren)) => {
  //       match &paren.expr.unwrap_parens() {
  //         Expr::Ident(id) => {
  //           self.mutate_value(id.to_id(), *span);
  //         }
  //         Expr::Member(member) => {
  //           self.eval_member_assign(member);
  //         }
  //         // TODO: are any other types of expressions valid here?
  //         _ => {}
  //       }
  //     }
  //     AssignTarget::Simple(SimpleAssignTarget::OptChain(member)) => match &*member.base {
  //       OptChainBase::Member(member) => {
  //         self.eval_member_assign(member);
  //       }
  //       OptChainBase::Call(..) => {}
  //     },
  //     AssignTarget::Simple(
  //       SimpleAssignTarget::TsAs(..)
  //       | SimpleAssignTarget::TsNonNull(..)
  //       | SimpleAssignTarget::TsSatisfies(..)
  //       | SimpleAssignTarget::TsInstantiation(..)
  //       | SimpleAssignTarget::TsTypeAssertion(..)
  //       | SimpleAssignTarget::Invalid(..),
  //     ) => {}
  //     AssignTarget::Pat(AssignTargetPat::Object(obj)) => {
  //       self.eval_object_pat(JsValue::Unknown(*span), obj, &mut Self::add_value);
  //     }
  //     AssignTarget::Pat(AssignTargetPat::Array(arr)) => {
  //       self.eval_array_pat(JsValue::Unknown(*span), arr, &mut Self::add_value);
  //     }
  //     AssignTarget::Pat(AssignTargetPat::Invalid(..)) => {}
  //   }

  //   todo!()
  // }
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
      JsValue::Array(arr) => {
        f.write_str("[")?;
        for (index, v) in arr.iter().enumerate() {
          if index > 0 {
            f.write_str(", ")?;
          }
          write!(f, "{}", v)?;
        }
        f.write_str("]")
      }
      JsValue::Object(obj) => {
        f.write_str("{")?;
        for (index, (k, v)) in obj.iter().enumerate() {
          if index > 0 {
            f.write_str(", ")?;
          }
          write!(f, "{}: {}", k, v)?
        }
        f.write_str("}")
      }
      JsValue::Function(_) => write!(f, "function"),
    }
  }
}

impl JsValue {
  /// Convert JS value to AST.
  pub fn into_expr(self) -> Result<Expr, ()> {
    Ok(match self {
      JsValue::Null => Expr::Lit(Lit::Null(Null::dummy())),
      JsValue::Undefined => Expr::Unary(UnaryExpr {
        span: DUMMY_SP,
        op: UnaryOp::Void,
        arg: 0.into(),
      }),
      JsValue::Bool(b) => b.into(),
      JsValue::Number(n) => n.into(),
      JsValue::BigInt(n) => n.into(),
      JsValue::String(s) => s.into(),
      JsValue::Regex { source, flags } => Expr::Lit(Lit::Regex(Regex {
        span: DUMMY_SP,
        exp: source.into(),
        flags: flags.into(),
      })),
      JsValue::Array(arr) => Expr::Array(ArrayLit {
        span: DUMMY_SP,
        elems: {
          let mut elems = Vec::new();
          for elem in arr.iter() {
            elems.push(Some(ExprOrSpread {
              spread: None,
              expr: Box::new(elem.clone().into_expr()?),
            }));
          }

          elems
        },
      }),
      JsValue::Object(obj) => obj.into_expr()?,
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
}

#[cfg(test)]
mod test {
  use super::*;
  use pretty_assertions::assert_eq;
  use swc_core::common::{sync::Lrc, FileName, SourceMap};
  use swc_core::ecma::parser::parse_file_as_expr;

  fn test(code: &str, expected: &str) {
    let source_map = Lrc::new(SourceMap::default());
    let source_file = source_map.new_source_file(Lrc::new(FileName::Anon), code.into());
    let expr = parse_file_as_expr(
      &source_file,
      Default::default(),
      Default::default(),
      None,
      &mut Vec::new(),
    )
    .unwrap();

    let mut evaluator = Evaluator::new();
    // collect_constants(&expr, &mut evaluator);
    let result = expr.evaluate(&evaluator);
    assert_eq!(&format!("{}", result), expected);
  }

  #[test]
  fn test_eval_bin_expr() {
    test("2", "2");
    test("2 + 2", "4");
    test("4 - 2", "2");
    test("2 * 3", "6");
    test("4 / 2", "2");
    test("2.5 / 2", "1.25");
    test("2 ** 4", "16");
    test("1 << 4", "16");
    test("4 >> 1", "2");
    test("4.2 >> 1", "2");
    test("4 >>> 1", "2");
    test("3 & 1", "1");
    test("1 | 2", "3");
    test("1 ^ 2", "3");
    test("3 || 1", "3");
    test("0 || 2", "2");
    test("2 == 2", "true");
    test("2 == 4", "false");
    test("'2' == 2", "unknown");
    test("2 === 2", "true");
    test("2 === 4", "false");
    // test("'2' === 2", "false");
    test("4 > 2", "true");
    test("2 > 4", "false");
    test("2 > 2", "false");
    test("4 < 2", "false");
    test("2 < 4", "true");
    test("2 < 2", "false");
    test("4 >= 2", "true");
    test("2 >= 4", "false");
    test("2 >= 2", "true");
    test("4 <= 2", "false");
    test("2 <= 4", "true");
    test("2 <= 2", "true");

    test("2n", "2n");
    test("2n + 2n", "4n");
    test("4n - 2n", "2n");
    test("2n * 3n", "6n");
    test("4n / 2n", "2n");
    test("2n ** 4n", "16n");
    test("1n << 4n", "16n");
    test("4n >> 1n", "2n");
    test("3n & 1n", "1n");
    test("1n | 2n", "3n");
    test("1n ^ 2n", "3n");
    test("3n || 1n", "3n");
    test("0n || 2n", "2n");
    test("2n == 2n", "true");
    test("2n == 4n", "false");
    test("'2' == 2n", "unknown");
    test("2n === 2n", "true");
    test("2n === 4n", "false");
    // test("'2' === 2n", "false");
    test("4n > 2n", "true");
    test("2n > 4n", "false");
    test("2n > 2n", "false");
    test("4n < 2n", "false");
    test("2n < 4n", "true");
    test("2n < 2n", "false");
    test("4n >= 2n", "true");
    test("2n >= 4n", "false");
    test("2n >= 2n", "true");
    test("4n <= 2n", "false");
    test("2n <= 4n", "true");
    test("2n <= 2n", "true");

    test("false || 'test'", "\"test\"");
    test("'test' || 'foo'", "\"test\"");
    test("'' || 'foo'", "\"foo\"");
    test("false && 'test'", "false");
    test("'test' && 'foo'", "\"foo\"");
    test("'' && 'foo'", "\"\"");

    test("'foo' + 'bar'", "\"foobar\"");
    test("'foo' + 2", "\"foo2\"");
    test("2 + 'bar'", "\"2bar\"");
    test("2 - '4'", "unknown");

    test("void 0 ?? 4", "4");
    test("null ?? 4", "4");
    test("false ?? 4", "false");
    test("8 ?? 4", "8");

    test("('foo' in {foo: 2})", "true");
    test("('foo' in {bar: 2})", "false");
  }

  #[test]
  fn test_unary() {
    test("!true", "false");
    test("!false", "true");
    test("!!true", "true");
    test("!0", "true");
    test("!1", "false");
    test("!''", "true");
    test("!'hi'", "false");
    test("!null", "true");
    test("-(4 + 3)", "-7");
    test("-(4n + 3n)", "-7n");
    test("+(4 - 8)", "-4");
    test("+'123'", "123");
    test("+'-123'", "-123");
    test("+'-123.582'", "-123.582");
    test("~4", "-5");
    test("~4.4", "-5");
    test("~4n", "-5n");
    test("void 0", "undefined");
    test("typeof 0", "\"number\"");
    test("typeof 0n", "\"bigint\"");
    test("typeof true", "\"boolean\"");
    test("typeof 'test'", "\"string\"");
    test("typeof {}", "\"object\"");
    test("typeof null", "\"object\"");
    // test("typeof (() => {})", "\"function\"");
  }

  #[test]
  fn test_cond() {
    test("true ? 3 : 4", "3");
    test("false ? 3 : 4", "4");
    test("0 ? 3 : 4", "4");
    test("1 ? 3 : 4", "3");
  }

  #[test]
  fn test_seq() {
    test("2 + 2, 3 + 4, 'hi'", "\"hi\"");
  }

  #[test]
  fn test_tpl() {
    test("`foo`", "\"foo\"");
    test("`foo_${'bar'}`", "\"foo_bar\"");
    test("`foo_${2}`", "\"foo_2\"");
    test("`foo_${true}`", "\"foo_true\"");
  }

  #[test]
  fn test_object() {
    test("{foo: 2}", "{foo: 2}");
    // test(
    //   "{get foo() {return 2}}",
    //   "{get foo() { side_effects = No; return 2 }}",
    // );
    // test("{set foo() {}}", "{set foo() { side_effects = No }}");
    // test(
    //   "{foo() { return 2 }}",
    //   "{foo: function() { side_effects = No; return 2 }}",
    // );
    test("{foo: 2, ...{bar: 3}}", "{foo: 2, bar: 3}");
    test("{foo: 2, ...[1, 2]}", "unknown");
    test("{foo: 2, ...unknown}", "unknown");
  }

  #[test]
  fn test_array() {
    test("[2, 3]", "[2, 3]");
    test("[2, ...[3, 4]]", "[2, 3, 4]");
    test("[2, ...unknown]", "unknown");
    test("[2, ...({foo: 2})]", "unknown");
  }

  #[test]
  fn test_member() {
    test("{foo: 2}.foo", "2");
    test("{foo: {bar: {baz: 2}}}.foo.bar.baz", "2");
    test("[2, 3, 4][2]", "4");
    test("[2, 3, 4].length", "3");
    test("'hello'.length", "5");
    test("{foo: 2}?.foo", "2");
    test("null?.foo", "undefined");
    // test("{get foo() {return 2}}.foo", "2");
  }

  #[test]
  fn test_function() {
    test("(function() { return 2 })()", "2");
    test("(function() { return })()", "undefined");
    test("(function() { return {foo: 2} })().foo", "2");
    test("(function(i) { return i + 2 })(4)", "6");
    test("(function({i}) { return i + 2 })({i: 4})", "6");
    test("(() => {return 2})()", "2");
    test("(() => {return})()", "undefined");
    test("(() => 2)()", "2");
    test("((i) => i + 2)(4)", "6");
    test("(({i}) => i + 2)({i: 4})", "6");
    test("{foo() { return 4 }}.foo()", "4");
    test("{foo() { return 4 }}?.foo()", "4");
  }
}
