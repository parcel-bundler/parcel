use std::{
  cell::{Ref, RefCell},
  cmp::Ordering,
  rc::Rc,
};

use itertools::Itertools;
use swc_core::{
  common::{Span, DUMMY_SP},
  ecma::{ast::*, atoms::Atom as JsWord},
};

use super::number::{to_integer_or_infinty, to_number};
use crate::{Evaluator, Function, JsValue, Object, StaticOrRc};

/// A JS array literal.
pub struct JsArray {
  pub(crate) arr: RefCell<Option<Vec<Option<JsValue>>>>,
}

impl JsArray {
  pub fn new(arr: Vec<Option<JsValue>>) -> Self {
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
          if *index < 0.0 {
            return JsValue::Undefined;
          }
          return arr
            .get(*index as usize)
            .cloned()
            .flatten()
            .unwrap_or(JsValue::Undefined);
        }
        JsValue::String(prop) => {
          return match prop.as_str() {
            "length" => JsValue::Number(arr.len() as f64),
            "at" => JsValue::Function((&at).into()),
            "every" => JsValue::Function((&every).into()),
            "some" => JsValue::Function((&some).into()),
            "filter" => JsValue::Function((&filter).into()),
            "find" => JsValue::Function((&find).into()),
            "findLast" => JsValue::Function((&find_last).into()),
            "findIndex" => JsValue::Function((&find_index).into()),
            "findLastIndex" => JsValue::Function((&find_last_index).into()),
            "includes" => JsValue::Function((&includes).into()),
            "indexOf" => JsValue::Function((&index_of).into()),
            "lastIndexOf" => JsValue::Function((&last_index_of).into()),
            "map" => JsValue::Function((&map).into()),
            "flat" => JsValue::Function((&flat).into()),
            "flatMap" => JsValue::Function((&flat_map).into()),
            "join" => JsValue::Function((&join).into()),
            "toReversed" => JsValue::Function((&to_reversed).into()),
            "slice" => JsValue::Function((&slice).into()),
            "reduce" => JsValue::Function((&reduce).into()),
            "reduceRight" => JsValue::Function((&reduce_right).into()),
            "toSorted" => JsValue::Function((&to_sorted).into()),
            _ => JsValue::Unknown(span),
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
          arr[index as usize] = Some(value);
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
            elems.push(if let Some(elem) = elem {
              Some(ExprOrSpread {
                spread: None,
                expr: Box::new(elem.clone().into_expr()?),
              })
            } else {
              None
            });
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
      arr
        .iter()
        .map(|i| {
          let i = i.as_ref().unwrap_or(&JsValue::Undefined);
          if matches!(i, JsValue::Undefined | JsValue::Null) {
            "".into()
          } else {
            i.to_string()
          }
        })
        .join(",")
        .into()
    } else {
      "[object Array]".into()
    }
  }
}

struct JsArrayValues<'a> {
  arr: Ref<'a, Option<Vec<Option<JsValue>>>>,
  index: usize,
}

impl<'a> Iterator for JsArrayValues<'a> {
  type Item = JsValue;

  fn next(&mut self) -> Option<Self::Item> {
    if let Some(arr) = &*self.arr {
      if self.index < arr.len() {
        let value = arr[self.index]
          .as_ref()
          .unwrap_or(&JsValue::Undefined)
          .clone();
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
  arr: Ref<'a, Option<Vec<Option<JsValue>>>>,
  index: usize,
}

impl<'a> Iterator for JsArrayEntries<'a> {
  type Item = (JsWord, JsValue);

  fn next(&mut self) -> Option<Self::Item> {
    if let Some(arr) = &*self.arr {
      if self.index < arr.len() {
        let value = arr[self.index]
          .as_ref()
          .unwrap_or(&JsValue::Undefined)
          .clone();
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

fn this_array(this: &JsValue) -> Option<Ref<Vec<Option<JsValue>>>> {
  if let JsValue::Object(obj) = this {
    if let Some(arr) = obj.as_any().downcast_ref::<JsArray>() {
      return Ref::filter_map(arr.arr.borrow(), |arr| arr.as_ref()).ok();
    }
  }

  None
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.at
fn at(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Number(index))) = (this_array(&this), args.get(0)) {
    let k = if *index >= 0.0 {
      *index as isize
    } else {
      (arr.len() as isize) + (*index as isize)
    };

    if k < 0 || (k as usize) >= arr.len() {
      JsValue::Undefined
    } else {
      arr[k as usize].clone().unwrap_or(JsValue::Undefined)
    }
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.every
fn every(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    for (index, value) in arr.iter().enumerate() {
      if let Some(value) = value {
        match f
          .call(
            this_arg.clone(),
            vec![value.clone(), JsValue::Number(index as f64), this.clone()],
            span,
            evaluator,
          )
          .coerse_to_bool()
        {
          None => return JsValue::Unknown(span),
          Some(false) => return JsValue::Bool(false),
          Some(true) => continue,
        }
      }
    }

    JsValue::Bool(true)
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.some
fn some(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    for (index, value) in arr.iter().enumerate() {
      if let Some(value) = value {
        match f
          .call(
            this_arg.clone(),
            vec![value.clone(), JsValue::Number(index as f64), this.clone()],
            span,
            evaluator,
          )
          .coerse_to_bool()
        {
          None => return JsValue::Unknown(span),
          Some(true) => return JsValue::Bool(true),
          Some(false) => continue,
        }
      }
    }

    JsValue::Bool(false)
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.filter
fn filter(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    let mut filtered = Vec::new();
    for (index, value) in arr.iter().enumerate() {
      if let Some(value) = value {
        match f
          .call(
            this_arg.clone(),
            vec![value.clone(), JsValue::Number(index as f64), this.clone()],
            span,
            evaluator,
          )
          .coerse_to_bool()
        {
          None => return JsValue::Unknown(span),
          Some(true) => filtered.push(Some(value.clone())),
          Some(false) => continue,
        }
      }
    }

    JsValue::Object(Rc::new(JsArray::new(filtered)).into())
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.find
fn find(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    for (index, value) in arr.iter().enumerate() {
      let value = value.as_ref().unwrap_or(&JsValue::Undefined);
      match f
        .call(
          this_arg.clone(),
          vec![value.clone(), JsValue::Number(index as f64), this.clone()],
          span,
          evaluator,
        )
        .coerse_to_bool()
      {
        None => return JsValue::Unknown(span),
        Some(true) => return value.clone(),
        Some(false) => continue,
      }
    }

    JsValue::Undefined
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.findlast
fn find_last(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    for (index, value) in arr.iter().enumerate().rev() {
      let value = value.as_ref().unwrap_or(&JsValue::Undefined);
      match f
        .call(
          this_arg.clone(),
          vec![value.clone(), JsValue::Number(index as f64), this.clone()],
          span,
          evaluator,
        )
        .coerse_to_bool()
      {
        None => return JsValue::Unknown(span),
        Some(true) => return value.clone(),
        Some(false) => continue,
      }
    }

    JsValue::Undefined
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.findindex
fn find_index(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    for (index, value) in arr.iter().enumerate() {
      let value = value.as_ref().unwrap_or(&JsValue::Undefined);
      match f
        .call(
          this_arg.clone(),
          vec![value.clone(), JsValue::Number(index as f64), this.clone()],
          span,
          evaluator,
        )
        .coerse_to_bool()
      {
        None => return JsValue::Unknown(span),
        Some(true) => return JsValue::Number(index as f64),
        Some(false) => continue,
      }
    }

    JsValue::Undefined
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.findlastindex
fn find_last_index(
  this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  evaluator: &Evaluator,
) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    for (index, value) in arr.iter().enumerate().rev() {
      let value = value.as_ref().unwrap_or(&JsValue::Undefined);
      match f
        .call(
          this_arg.clone(),
          vec![value.clone(), JsValue::Number(index as f64), this.clone()],
          span,
          evaluator,
        )
        .coerse_to_bool()
      {
        None => return JsValue::Unknown(span),
        Some(true) => return JsValue::Number(index as f64),
        Some(false) => continue,
      }
    }

    JsValue::Undefined
  } else {
    JsValue::Unknown(span)
  }
}

fn search_index(arr: &Vec<Option<JsValue>>, from_index: f64) -> usize {
  let mut from_index = if from_index.is_infinite() {
    0
  } else if from_index >= 0.0 {
    from_index as usize
  } else {
    let k = (arr.len() as isize) + (from_index as isize);
    if k < 0 {
      0
    } else {
      k as usize
    }
  };

  if from_index > arr.len() {
    from_index = arr.len();
  }

  from_index
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.includes
fn includes(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(search)) = (this_array(&this), args.get(0)) {
    let Ok(from_index) = to_integer_or_infinty(args.get(1).unwrap_or(&JsValue::Undefined)) else {
      return JsValue::Unknown(span);
    };
    if from_index.is_sign_positive() && from_index.is_infinite() {
      return JsValue::Bool(false);
    }
    let from_index = search_index(&arr, from_index);

    for value in &arr[from_index..] {
      let value = value.as_ref().unwrap_or(&JsValue::Undefined);
      match search.same_value_zero(value) {
        None => return JsValue::Unknown(span),
        Some(true) => return JsValue::Bool(true),
        Some(false) => continue,
      }
    }

    JsValue::Bool(false)
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.indexof
fn index_of(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(search)) = (this_array(&this), args.get(0)) {
    if arr.len() == 0 {
      return JsValue::Number(-1.0);
    }

    let Ok(from_index) = to_integer_or_infinty(args.get(1).unwrap_or(&JsValue::Undefined)) else {
      return JsValue::Unknown(span);
    };
    if from_index.is_sign_positive() && from_index.is_infinite() {
      return JsValue::Number(-1.0);
    }
    let from_index = search_index(&arr, from_index);

    for (index, value) in arr[from_index..].iter().enumerate() {
      if let Some(value) = value {
        match search.is_strictly_equal(value) {
          None => return JsValue::Unknown(span),
          Some(true) => return JsValue::Number((from_index + index) as f64),
          Some(false) => continue,
        }
      }
    }

    JsValue::Number(-1.0)
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.lastindexof
fn last_index_of(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(search)) = (this_array(&this), args.get(0)) {
    if arr.len() == 0 {
      return JsValue::Number(-1.0);
    }

    let Ok(from_index) = to_integer_or_infinty(
      args
        .get(1)
        .unwrap_or(&JsValue::Number((arr.len() - 1) as f64)),
    ) else {
      return JsValue::Unknown(span);
    };
    if from_index.is_sign_negative() && from_index.is_infinite() {
      return JsValue::Number(-1.0);
    }
    let from_index = if from_index >= 0.0 {
      (from_index as usize).min(arr.len() - 1)
    } else {
      let k = (arr.len() as isize) + (from_index as isize);
      if k < 0 {
        return JsValue::Number(-1.0);
      }
      (k as usize).min(arr.len() - 1)
    };

    for (index, value) in arr[0..=from_index].iter().enumerate().rev() {
      if let Some(value) = value {
        match search.is_strictly_equal(value) {
          None => return JsValue::Unknown(span),
          Some(true) => return JsValue::Number(index as f64),
          Some(false) => continue,
        }
      }
    }

    JsValue::Number(-1.0)
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.map
fn map(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    let mapped = arr
      .iter()
      .enumerate()
      .map(|(index, value)| {
        if let Some(value) = value {
          Some(f.call(
            this_arg.clone(),
            vec![value.clone(), JsValue::Number(index as f64), this.clone()],
            span,
            evaluator,
          ))
        } else {
          None
        }
      })
      .collect();

    JsValue::Object(Rc::new(JsArray::new(mapped)).into())
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.flat
fn flat(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  let Ok(mut depth) = to_integer_or_infinty(args.get(0).unwrap_or(&JsValue::Number(1.0))) else {
    return JsValue::Unknown(span);
  };
  if depth < 0.0 {
    depth = 0.0;
  }
  let mut target = Vec::new();
  if flatten_into_array(
    &mut target,
    &this,
    depth as usize,
    None,
    JsValue::Undefined,
    span,
    evaluator,
  )
  .is_err()
  {
    return JsValue::Unknown(span);
  }
  JsValue::Object(Rc::new(JsArray::new(target)).into())
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.flatmap
fn flat_map(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let Some(JsValue::Function(f)) = args.get(0) {
    let this_arg = args.get(1).unwrap_or(&JsValue::Undefined);
    let mut target = Vec::new();
    if flatten_into_array(
      &mut target,
      &this,
      1,
      Some(f.clone()),
      this_arg.clone(),
      span,
      evaluator,
    )
    .is_err()
    {
      return JsValue::Unknown(span);
    }
    JsValue::Object(Rc::new(JsArray::new(target)).into())
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-flattenintoarray
fn flatten_into_array(
  target: &mut Vec<Option<JsValue>>,
  source: &JsValue,
  depth: usize,
  map: Option<StaticOrRc<dyn Function>>,
  this_arg: JsValue,
  span: Span,
  evaluator: &Evaluator,
) -> Result<(), ()> {
  if let Some(source_arr) = this_array(&source) {
    for (index, element) in source_arr.iter().enumerate() {
      if let Some(element) = element {
        let element = if let Some(map) = &map {
          map.call(
            this_arg.clone(),
            vec![
              element.clone(),
              JsValue::Number(index as f64),
              source.clone(),
            ],
            span,
            evaluator,
          )
        } else {
          element.clone()
        };
        if !element.is_known() {
          return Err(());
        }
        let mut should_flatten = false;
        if depth > 0 {
          should_flatten = matches!(&element, JsValue::Object(obj) if obj.as_any().is::<JsArray>());
        }
        if should_flatten {
          flatten_into_array(
            target,
            &element,
            depth - 1,
            None,
            JsValue::Undefined,
            span,
            evaluator,
          )?;
        } else {
          target.push(Some(element));
        }
      }
    }
  }

  Ok(())
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.flatmap
fn join(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(arr) = this_array(&this) {
    let separator = args
      .get(0)
      .cloned()
      .unwrap_or_else(|| JsValue::String(",".into()))
      .to_string();

    JsValue::String(
      arr
        .iter()
        .map(|v| {
          let v = v.as_ref().unwrap_or(&JsValue::Undefined);
          if matches!(v, JsValue::Undefined | JsValue::Null) {
            "".into()
          } else {
            v.to_string()
          }
        })
        .join(separator.as_str())
        .into(),
    )
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.toreversed
fn to_reversed(this: JsValue, _args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(arr) = this_array(&this) {
    let reversed = arr
      .iter()
      .rev()
      .map(|v| Some(v.clone().unwrap_or(JsValue::Undefined)))
      .collect();
    JsValue::Object(Rc::new(JsArray::new(reversed)).into())
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.slice
fn slice(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(arr) = this_array(&this) {
    let Ok(relative_start) = to_integer_or_infinty(args.get(0).unwrap_or(&JsValue::Undefined))
    else {
      return JsValue::Unknown(span);
    };
    let start = if relative_start.is_sign_negative() && relative_start.is_infinite() {
      0
    } else if relative_start < 0.0 {
      (arr.len() as isize + relative_start as isize).max(0) as usize
    } else {
      (relative_start as usize).min(arr.len())
    };

    let end = args.get(1).unwrap_or(&JsValue::Undefined);
    let relative_end = if matches!(end, JsValue::Undefined) {
      arr.len() as f64
    } else {
      let Ok(relative_end) = to_integer_or_infinty(end) else {
        return JsValue::Unknown(span);
      };
      relative_end
    };
    let end = if relative_end.is_sign_negative() && relative_end.is_infinite() {
      0
    } else if relative_end < 0.0 {
      ((arr.len() as isize) + (relative_end as isize)).max(0) as usize
    } else {
      (relative_end as usize).min(arr.len())
    };

    let slice = arr[start..end].to_vec();
    JsValue::Object(Rc::new(JsArray::new(slice)).into())
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.reduce
fn reduce(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let initial_value = args.get(1);
    if arr.is_empty() && initial_value.is_none() {
      return JsValue::Unknown(span);
    }

    let mut k = 0;
    let mut accumulator = JsValue::Undefined;
    if let Some(initial) = initial_value {
      accumulator = initial.clone();
    } else if !arr.is_empty() {
      let mut k_present = false;
      while !k_present && k < arr.len() {
        if let Some(item) = &arr[k] {
          k_present = true;
          accumulator = item.clone();
        }
        k += 1;
      }
      if !k_present {
        return JsValue::Unknown(span);
      }
    }

    while k < arr.len() {
      if let Some(item) = &arr[k] {
        accumulator = f.call(
          JsValue::Undefined,
          vec![
            accumulator,
            item.clone(),
            JsValue::Number(k as f64),
            this.clone(),
          ],
          span,
          evaluator,
        );
      }

      k += 1;
    }

    accumulator
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.reduceright
fn reduce_right(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let (Some(arr), Some(JsValue::Function(f))) = (this_array(&this), args.get(0)) {
    let initial_value = args.get(1);
    if arr.is_empty() {
      return initial_value.cloned().unwrap_or(JsValue::Unknown(span));
    }

    let mut k = arr.len() - 1;
    let mut accumulator = JsValue::Undefined;
    if let Some(initial) = initial_value {
      accumulator = initial.clone();
    } else if !arr.is_empty() {
      let mut k_present = false;
      while !k_present {
        if let Some(item) = &arr[k] {
          k_present = true;
          accumulator = item.clone();
        }
        if k == 0 {
          break;
        }
        k -= 1;
      }
      if !k_present {
        return JsValue::Unknown(span);
      }
    }

    loop {
      if let Some(item) = &arr[k] {
        accumulator = f.call(
          JsValue::Undefined,
          vec![
            accumulator,
            item.clone(),
            JsValue::Number(k as f64),
            this.clone(),
          ],
          span,
          evaluator,
        );
      }

      if k == 0 {
        break;
      }
      k -= 1;
    }

    accumulator
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.tosorted
fn to_sorted(this: JsValue, args: Vec<JsValue>, span: Span, evaluator: &Evaluator) -> JsValue {
  if let Some(arr) = this_array(&this) {
    let comparator = if let Some(comparator) = args.get(0) {
      if !matches!(comparator, JsValue::Function(_)) {
        return JsValue::Unknown(span);
      }
      comparator.clone()
    } else {
      JsValue::Undefined
    };

    // Read through holes.
    let mut mapped: Vec<_> = arr
      .iter()
      .map(|v| Some(v.clone().unwrap_or(JsValue::Undefined)))
      .collect();

    mapped.sort_by(|x, y| {
      compare_array_elements(
        x.as_ref().unwrap(),
        y.as_ref().unwrap(),
        &comparator,
        span,
        evaluator,
      )
    });

    JsValue::Object(Rc::new(JsArray::new(mapped)).into())
  } else {
    JsValue::Unknown(span)
  }
}

// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-comparearrayelements
fn compare_array_elements(
  x: &JsValue,
  y: &JsValue,
  comparator: &JsValue,
  span: Span,
  evaluator: &Evaluator,
) -> Ordering {
  match (x, y) {
    (JsValue::Undefined, JsValue::Undefined) => Ordering::Equal,
    (JsValue::Undefined, _) => Ordering::Greater,
    (_, JsValue::Undefined) => Ordering::Less,
    _ => {
      if let JsValue::Function(comparator) = comparator {
        let Ok(v) = to_number(&comparator.call(
          JsValue::Undefined,
          vec![x.clone(), y.clone()],
          span,
          evaluator,
        )) else {
          return Ordering::Equal;
        };
        if v.is_nan() || v == 0.0 {
          Ordering::Equal
        } else if v < 0.0 {
          Ordering::Less
        } else {
          Ordering::Greater
        }
      } else {
        let x_string = x.to_string();
        let y_string = y.to_string();
        x_string.cmp(&y_string)
      }
    }
  }
}
