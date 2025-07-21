use std::cell::{Ref, RefCell};

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

  #[allow(unused)]
  fn set(&self, prop: JsValue, value: JsValue) {}

  #[allow(unused)]
  fn has(&self, prop: &JsValue) -> bool {
    false
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    Box::new(std::iter::empty())
  }

  fn values<'a>(&'a self) -> Option<Box<dyn Iterator<Item = JsValue> + 'a>> {
    None
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    Err(())
  }

  fn update_expr(&self, expr: &mut Expr) -> Result<(), ()> {
    if let Ok(res) = self.into_expr() {
      *expr = res;
      Ok(())
    } else {
      Err(())
    }
  }

  fn to_string(&self) -> JsWord {
    "[object Object]".into()
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

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
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

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
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

/// A JS object literal.
pub struct JsObject {
  map: RefCell<Option<IndexMap<JsWord, JsValue>>>,
}

impl JsObject {
  pub fn new(map: IndexMap<JsWord, JsValue>) -> Self {
    JsObject {
      map: RefCell::new(Some(map)),
    }
  }
}

impl Object for JsObject {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    let map = self.map.borrow();
    if let Some(map) = &*map {
      Object::get(map, prop, span)
    } else {
      JsValue::Unknown(span)
    }
  }

  fn set(&self, prop: JsValue, value: JsValue) {
    let mut map_ref = self.map.borrow_mut();
    if let Some(map) = &mut *map_ref {
      if prop.is_known() {
        map.insert(prop.to_string(), value);
      } else {
        *map_ref = None;
      }
    }
  }

  fn has(&self, prop: &JsValue) -> bool {
    let map = self.map.borrow();
    if let Some(map) = &*map {
      map.has(prop)
    } else {
      false
    }
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    let map = self.map.borrow();
    Box::new(JsObjectIter { map, index: 0 })
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    let map = self.map.borrow();
    if let Some(map) = &*map {
      map.into_expr()
    } else {
      Err(())
    }
  }
}

struct JsObjectIter<'a> {
  map: Ref<'a, Option<IndexMap<JsWord, JsValue>>>,
  index: usize,
}

impl<'a> Iterator for JsObjectIter<'a> {
  type Item = (JsWord, JsValue);

  fn next(&mut self) -> Option<Self::Item> {
    if let Some(map) = &*self.map {
      let res = map.get_index(self.index);
      self.index += 1;
      res.map(|(a, b)| (a.clone(), b.clone()))
    } else {
      None
    }
  }
}
