use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use super::JsValue;
use napi::bindgen_prelude::FromNapiValue;
use napi::Env;
use napi::JsFunction;

thread_local! {
  /// Storage for napi JavaScript functions on the local thread
  static LOCAL_FUNCTIONS: (RefCell<usize>, RefCell<HashMap<usize, Rc<JsValue>>>) = Default::default();
}

pub fn set_local_function(callback: JsFunction) -> napi::Result<usize> {
  LOCAL_FUNCTIONS.with(move |(counter, map)| -> napi::Result<usize> {
    let mut counter = counter.borrow_mut();
    let mut map = map.borrow_mut();

    let index = counter.clone();
    let value = JsValue::from_unknown(callback.into_unknown())?;
    map.insert(index.clone(), Rc::new(value));

    *counter += 1;
    Ok(index)
  })
}

pub fn get_local_function(index: &usize) -> napi::Result<Option<(JsFunction, Env)>> {
  LOCAL_FUNCTIONS.with(move |(_, map)| {
    let map = map.borrow();
    let Some(value) = map.get(index).map(|v| v.clone()) else {
      return Ok(None);
    };

    let env = value.1;
    let callback = value.cast::<JsFunction>()?;
    Ok(Some((callback, env)))
  })
}

pub fn remove_local_function(index: &usize) {
  LOCAL_FUNCTIONS.with(move |(_, map)| {
    let mut map = map.borrow_mut();
    map.remove(&index);
  })
}
