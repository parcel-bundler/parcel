use std::cell::{Ref, RefCell};

use itertools::Itertools;
use swc_core::{
  common::{Span, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

use crate::{JsValue, Object};

/// A JS array literal.
pub struct JsArray {
  arr: RefCell<Option<Vec<JsValue>>>,
}

impl JsArray {
  pub fn new(arr: Vec<JsValue>) -> Self {
    JsArray {
      arr: RefCell::new(Some(arr)),
    }
  }
}

impl Object for JsArray {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    let arr = self.arr.borrow();
    if let Some(arr) = &*arr {
      match prop {
        JsValue::Number(index) => {
          return arr
            .get(*index as usize)
            .cloned()
            .unwrap_or(JsValue::Undefined);
        }
        JsValue::String(prop) => {
          if prop == "length" {
            return JsValue::Number(arr.len() as f64);
          }
        }
        _ => {}
      }
    }

    JsValue::Unknown(span)
  }

  fn set(&self, prop: JsValue, value: JsValue) {
    let mut arr_ref = self.arr.borrow_mut();
    if let Some(arr) = &mut *arr_ref {
      match prop {
        JsValue::Number(index) if (index as usize) < arr.len() => {
          arr[index as usize] = value;
        }
        _ => {
          *arr_ref = None;
        }
      }
    }
  }

  fn has(&self, prop: &JsValue) -> bool {
    let arr = self.arr.borrow();
    if let Some(arr) = &*arr {
      match prop {
        JsValue::Number(index) => {
          return (*index as usize) < arr.len();
        }
        JsValue::String(prop) => {
          return prop == "length";
        }
        _ => {}
      }
    }

    false
  }

  fn entries<'a>(&'a self) -> Box<dyn Iterator<Item = (JsWord, JsValue)> + 'a> {
    let arr = self.arr.borrow();
    Box::new(JsArrayEntries { arr, index: 0 })
  }

  fn values<'a>(&'a self) -> Option<Box<dyn Iterator<Item = JsValue> + 'a>> {
    let arr = self.arr.borrow();
    Some(Box::new(JsArrayValues { arr, index: 0 }))
  }

  fn into_expr(&self) -> Result<Expr, ()> {
    let arr = self.arr.borrow();
    if let Some(arr) = &*arr {
      Ok(Expr::Array(ArrayLit {
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
      }))
    } else {
      Err(())
    }
  }

  fn to_string(&self) -> JsWord {
    let arr = self.arr.borrow();
    if let Some(arr) = &*arr {
      arr.iter().map(|i| i.to_string()).join(",").into()
    } else {
      "[object Array]".into()
    }
  }
}

struct JsArrayValues<'a> {
  arr: Ref<'a, Option<Vec<JsValue>>>,
  index: usize,
}

impl<'a> Iterator for JsArrayValues<'a> {
  type Item = JsValue;

  fn next(&mut self) -> Option<Self::Item> {
    if let Some(arr) = &*self.arr {
      if self.index < arr.len() {
        let value = arr[self.index].clone();
        self.index += 1;
        Some(value)
      } else {
        None
      }
    } else {
      None
    }
  }
}

struct JsArrayEntries<'a> {
  arr: Ref<'a, Option<Vec<JsValue>>>,
  index: usize,
}

impl<'a> Iterator for JsArrayEntries<'a> {
  type Item = (JsWord, JsValue);

  fn next(&mut self) -> Option<Self::Item> {
    if let Some(arr) = &*self.arr {
      if self.index < arr.len() {
        let value = arr[self.index].clone();
        let key = self.index.to_string().into();
        self.index += 1;
        Some((key, value))
      } else {
        None
      }
    } else {
      None
    }
  }
}
