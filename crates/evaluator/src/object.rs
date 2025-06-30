use as_any::AsAny;
use indexmap::IndexMap;
use swc_core::{
  common::{Span, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::JsValue;

pub trait Object: AsAny {
  #[allow(unused)]
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    JsValue::Unknown(span)
  }

  fn set(&self, prop: JsWord, value: JsValue) {}

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

  fn set(&self, prop: JsWord, value: JsValue) {
    // self.insert(prop, value);
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
