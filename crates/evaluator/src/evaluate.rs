use std::{
  collections::{HashMap, HashSet},
  rc::Rc,
};

use indexmap::IndexMap;
use num_bigint::Sign;
use num_traits::{Pow, ToPrimitive};
use swc_core::{
  common::{Span, Spanned, DUMMY_SP},
  ecma::ast::*,
};

use crate::{promise::PromiseInstance, JsArray, JsFunction, JsObject, JsValue};

pub struct Evaluator<'a> {
  pub(crate) values: HashMap<Id, JsValue>,
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

  pub fn mutate_value(&mut self, id: Id, span: Span) {
    self.values.insert(id, JsValue::Unknown(span));
  }

  pub fn remove(&mut self, id: Id) {
    self.values.remove(&id);
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
    let mut values = value
      .values()
      .unwrap_or_else(|| Box::new(std::iter::empty()));

    for elem in arr.elems.iter() {
      let mut value = values.next();
      if let Some(elem) = elem {
        match elem {
          Pat::Array(ArrayPat { span, .. })
          | Pat::Object(ObjectPat { span, .. })
          | Pat::Ident(BindingIdent {
            id: Ident { span, .. },
            ..
          }) => self.eval_pat(value.unwrap_or(JsValue::Unknown(*span)), elem, add_value),
          Pat::Rest(rest) => self.eval_pat(
            JsValue::Object(Rc::new(JsArray::new(values.by_ref().collect())).into()),
            &*rest.arg,
            add_value,
          ),
          Pat::Assign(assign) => {
            let right = assign.right.evaluate(self);
            if matches!(value, Some(JsValue::Undefined)) {
              value = Some(right);
            }
            self.eval_pat(
              value.unwrap_or(JsValue::Unknown(assign.span)),
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
              .entries()
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

  pub fn eval_mutation(&mut self, expr: &Expr) {
    match expr {
      Expr::Assign(assign) => {
        self.eval_assign_target(&assign.left);
      }
      Expr::Update(update) => {
        self.eval_update_expr(update);
      }
      Expr::Unary(unary) => {
        self.eval_unary_expr_mutation(unary);
      }
      Expr::Call(call) => {
        let callee = call.callee.evaluate(self);
        if !callee.is_known() {
          if let Callee::Expr(callee) = &call.callee {
            if let Expr::Member(member) = &**callee {
              let this = member.obj.evaluate(self);
              if let JsValue::Object(obj) = this {
                // Mark `this` object as potentially mutated.
                obj.set(JsValue::Unknown(call.span), JsValue::Unknown(call.span));
              }
            }
          }

          let args = eval_args(&call.args, self);
          for arg in args {
            if let JsValue::Object(obj) = arg {
              // Mark object as potentially mutated.
              obj.set(JsValue::Unknown(call.span), JsValue::Unknown(call.span));
            }
          }
        }
      }
      Expr::OptChain(opt_chain) => {
        if let OptChainBase::Call(call) = &*opt_chain.base {
          let callee = call.callee.evaluate(self);
          if !callee.is_known() {
            let this = evaluate_call_this(&*call.callee, self);
            if let JsValue::Object(obj) = this {
              // Mark `this` object as potentially mutated.
              obj.set(JsValue::Unknown(call.span), JsValue::Unknown(call.span));
            }

            let args = eval_args(&call.args, self);
            for arg in args {
              if let JsValue::Object(obj) = arg {
                // Mark object as potentially mutated.
                obj.set(JsValue::Unknown(call.span), JsValue::Unknown(call.span));
              }
            }
          }
        }
      }
      _ => {}
    }
  }

  fn eval_assign_target(&mut self, target: &AssignTarget) {
    match target {
      AssignTarget::Simple(SimpleAssignTarget::Ident(id)) => {
        self.mutate_value(id.to_id(), target.span());
      }
      AssignTarget::Simple(SimpleAssignTarget::Member(member)) => {
        // TODO: handle if the setter function mutates the value
        self.eval_member_assign(member);
      }
      AssignTarget::Simple(SimpleAssignTarget::SuperProp(..)) => {}
      AssignTarget::Simple(SimpleAssignTarget::Paren(paren)) => {
        match &paren.expr.unwrap_parens() {
          Expr::Ident(id) => {
            self.mutate_value(id.to_id(), target.span());
          }
          Expr::Member(member) => {
            self.eval_member_assign(member);
          }
          // TODO: are any other types of expressions valid here?
          _ => {}
        }
      }
      AssignTarget::Simple(SimpleAssignTarget::OptChain(member)) => match &*member.base {
        OptChainBase::Member(member) => {
          self.eval_member_assign(member);
        }
        OptChainBase::Call(..) => {}
      },
      AssignTarget::Simple(
        SimpleAssignTarget::TsAs(..)
        | SimpleAssignTarget::TsNonNull(..)
        | SimpleAssignTarget::TsSatisfies(..)
        | SimpleAssignTarget::TsInstantiation(..)
        | SimpleAssignTarget::TsTypeAssertion(..)
        | SimpleAssignTarget::Invalid(..),
      ) => {}
      AssignTarget::Pat(AssignTargetPat::Object(obj)) => {
        self.eval_object_pat(JsValue::Unknown(target.span()), obj, &mut Self::add_value);
      }
      AssignTarget::Pat(AssignTargetPat::Array(arr)) => {
        self.eval_array_pat(JsValue::Unknown(target.span()), arr, &mut Self::add_value);
      }
      AssignTarget::Pat(AssignTargetPat::Invalid(..)) => {}
    }
  }

  fn eval_member_assign(&mut self, mut member: &MemberExpr) {
    // Try to mark the object property as unknown. If the expression does
    // not resolve to a known object, try the parent member expression if any.
    loop {
      if let JsValue::Object(obj) = member.obj.evaluate(self) {
        match &member.prop {
          MemberProp::Ident(id) => {
            obj.set(JsValue::String(id.sym.clone()), JsValue::Unknown(id.span));
            break;
          }
          MemberProp::Computed(prop) => {
            let key = prop.expr.evaluate(self);
            if key.is_known() {
              obj.set(key, JsValue::Unknown(prop.span));
              break;
            }
          }
          MemberProp::PrivateName(_) => {}
        }

        // Mark all object properties as unknown.
        obj.set(JsValue::Unknown(member.span), JsValue::Unknown(member.span));
        break;
      } else if let Expr::Member(m) = &*member.obj {
        member = m;
      } else if let Expr::Ident(id) = &*member.obj {
        self.mutate_value(id.to_id(), member.span);
        break;
      } else {
        break;
      }
    }
  }

  fn eval_update_expr(&mut self, update: &UpdateExpr) {
    match &*update.arg {
      Expr::Ident(id) => {
        self.mutate_value(id.to_id(), update.span);
      }
      Expr::Member(member) => {
        self.eval_member_assign(member);
      }
      _ => {}
    }
  }

  fn eval_unary_expr_mutation(&mut self, unary: &UnaryExpr) {
    if unary.op == UnaryOp::Delete {
      match &*unary.arg {
        Expr::Ident(id) => {
          self.mutate_value(id.to_id(), unary.span);
        }
        Expr::Member(member) => {
          self.eval_member_assign(member);
        }
        _ => {}
      }
    }
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
      Expr::Await(await_expr) => await_expr.evaluate(evaluator),
      Expr::TsTypeAssertion(ts_type_assertion) => ts_type_assertion.evaluate(evaluator),
      Expr::TsConstAssertion(ts_const_assertion) => ts_const_assertion.evaluate(evaluator),
      Expr::TsNonNull(ts_non_null_expr) => ts_non_null_expr.evaluate(evaluator),
      Expr::TsAs(ts_as_expr) => ts_as_expr.evaluate(evaluator),
      Expr::TsInstantiation(ts_instantiation) => ts_instantiation.evaluate(evaluator),
      Expr::TsSatisfies(ts_satisfies_expr) => ts_satisfies_expr.evaluate(evaluator),
      Expr::Class(class_expr) => JsValue::Unknown(class_expr.class.span),
      Expr::TaggedTpl(tagged_tpl) => JsValue::Unknown(tagged_tpl.span),
      Expr::Update(update_expr) => JsValue::Unknown(update_expr.span),
      Expr::Assign(assign_expr) => JsValue::Unknown(assign_expr.span),
      Expr::SuperProp(super_prop_expr) => JsValue::Unknown(super_prop_expr.span),
      Expr::Yield(yield_expr) => JsValue::Unknown(yield_expr.span),
      Expr::JSXMember(jsxmember_expr) => JsValue::Unknown(jsxmember_expr.span),
      Expr::JSXNamespacedName(jsxnamespaced_name) => JsValue::Unknown(jsxnamespaced_name.span),
      Expr::JSXEmpty(jsxempty_expr) => JsValue::Unknown(jsxempty_expr.span),
      Expr::JSXElement(jsxelement) => JsValue::Unknown(jsxelement.span),
      Expr::JSXFragment(jsxfragment) => JsValue::Unknown(jsxfragment.span),
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
    let mut res = Vec::<JsValue>::with_capacity(self.elems.len());
    for elem in &self.elems {
      if let Some(elem) = elem {
        let val = elem.expr.evaluate(evaluator);
        if elem.spread.is_some() {
          if let Some(values) = val.values() {
            res.extend(values);
          } else {
            return JsValue::Unknown(self.span);
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
    JsValue::Object(Rc::new(JsArray::new(res)).into())
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
              res.insert(k.to_string(), v);
            } else {
              return k;
            }
          }
          Prop::Shorthand(s) => {
            let val = s.evaluate(evaluator);
            res.insert(s.sym.clone(), val);
          }
          Prop::Method(method) => {
            let k = method.key.evaluate(evaluator);
            let f = method.function.evaluate(evaluator);
            if k.is_known() {
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
            JsValue::Object(o) => res.extend(o.entries()),
            _ => return JsValue::Unknown(self.span),
          }
        }
      }
    }
    JsValue::Object(Rc::new(JsObject::new(res)).into())
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
      (BinaryOp::Add, JsValue::String(a), JsValue::Number(b)) => {
        JsValue::String(format!("{}{}", a, b).into())
      }
      (BinaryOp::Add, JsValue::String(a), b) => {
        JsValue::String(format!("{}{}", a, b.to_string()).into())
      }
      (BinaryOp::Add, JsValue::Number(a), JsValue::Number(b)) => JsValue::Number(a + b),
      (BinaryOp::Add, JsValue::BigInt(a), JsValue::BigInt(b)) => JsValue::BigInt(a + b),
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
          let this = evaluate_call_this(&*call.callee, evaluator);
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
        let this = evaluate_call_this(&**callee, evaluator);
        let callee = callee.evaluate(evaluator);
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

fn evaluate_call_this(callee: &Expr, evaluator: &Evaluator) -> JsValue {
  match &callee {
    Expr::Member(member) => member.obj.evaluate(evaluator),
    Expr::OptChain(chain) => {
      if let OptChainBase::Member(member) = &*chain.base {
        member.obj.evaluate(evaluator)
      } else {
        JsValue::Undefined
      }
    }
    _ => JsValue::Undefined,
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
        Left(if let Some(values) = value.values() {
          Left(values.collect::<Vec<_>>().into_iter())
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

impl Evaluate for AwaitExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    let arg = self.arg.evaluate(evaluator);
    match arg {
      JsValue::Object(obj) => {
        if let Some(promise) = obj.as_any().downcast_ref::<PromiseInstance>() {
          promise.value()
        } else {
          JsValue::Unknown(self.span)
        }
      }
      _ => JsValue::Unknown(self.span),
    }
  }
}

impl Evaluate for TsTypeAssertion {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}

impl Evaluate for TsConstAssertion {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}

impl Evaluate for TsNonNullExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}

impl Evaluate for TsAsExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}

impl Evaluate for TsInstantiation {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}

impl Evaluate for TsSatisfiesExpr {
  fn evaluate(&self, evaluator: &Evaluator) -> JsValue {
    self.expr.evaluate(evaluator)
  }
}
