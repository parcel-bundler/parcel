extern crate parcel_js_swc_core;

use js_sys::Error;
use serde_wasm_bindgen;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn transform(config_val: JsValue) -> Result<JsValue, JsValue> {
  let config: parcel_js_swc_core::Config =
    serde_wasm_bindgen::from_value(config_val).map_err(|err| JsValue::from(err))?;
  let result = parcel_js_swc_core::transform(config)
    .map_err(|e| Error::from(JsValue::from_str(&e.to_string())))?;
  Ok(serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from(err))?)
}
