use std::{cell::RefCell, collections::HashSet};

use indexmap::IndexMap;
use std::rc::Rc;
use swc_core::{
  common::{Span, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::{Evaluator, JsValue, Object};

pub struct Process {
  pub env: Rc<EnvObject>,
  pub browser: bool,
}

impl Object for Process {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop.to_string().as_str() {
      "env" => JsValue::Object(self.env.clone().into()),
      "browser" => {
        if self.browser {
          JsValue::Bool(true)
        } else {
          JsValue::Unknown(span)
        }
      }
      _ => JsValue::Unknown(span),
    }
  }

  fn has(&self, prop: &JsValue) -> bool {
    matches!(prop.to_string().as_str(), "env" | "browser")
  }
}

pub struct EnvObject {
  env: IndexMap<JsWord, JsWord>,
  used_env: RefCell<HashSet<JsWord>>,
}

impl EnvObject {
  pub fn new(env: IndexMap<JsWord, JsWord>) -> Self {
    Self {
      env,
      used_env: RefCell::new(HashSet::new()),
    }
  }
}

impl Object for EnvObject {
  fn get(&self, prop: &JsValue, span: swc_core::common::Span) -> JsValue {
    let key = prop.to_string();
    match key.as_str() {
      // don't replace process.env.hasOwnProperty with undefined
      // "hasOwnProperty"
      "isPrototypeOf"
      | "propertyIsEnumerable"
      | "toLocaleString"
      | "toSource"
      | "toString"
      | "valueOf" => return JsValue::Unknown(span),
      _ => {}
    }

    if key == "hasOwnProperty" {
      return JsValue::Function((&has_own_property).into());
    }

    let res = self
      .env
      .get(&key)
      .map(|v| JsValue::String(v.clone()))
      .unwrap_or(JsValue::Undefined);

    self.used_env.borrow_mut().insert(key);
    res
  }

  fn has(&self, prop: &JsValue) -> bool {
    let key = prop.to_string();
    let res = self.env.contains_key(&key);
    self.used_env.borrow_mut().insert(key);
    res
  }

  fn iter<'s>(&'s self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 's> {
    self.used_env.borrow_mut().extend(self.env.keys().cloned());
    Box::new(
      self
        .env
        .iter()
        .map(|(k, v)| (k.clone(), JsValue::String(v.clone()))),
    )
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

fn has_own_property(
  this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let (JsValue::Object(obj), Some(prop)) = (this, args.get(0)) {
    JsValue::Bool(obj.has(prop))
  } else {
    JsValue::Unknown(span)
  }
}
