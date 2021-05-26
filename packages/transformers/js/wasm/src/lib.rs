extern crate parcel_js_swc_core;

use js_sys::Error;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn transform(config_val: JsValue) -> Result<JsValue, JsValue> {
  let config = config_val
    .into_serde()
    .map_err(|e| Error::from(JsValue::from_str(&e.to_string())))?;
  let result = parcel_js_swc_core::transform(config)
    .map_err(|e| Error::from(JsValue::from_str(&e.to_string())))?;
  Ok(JsValue::from_serde(&result).unwrap())
}
