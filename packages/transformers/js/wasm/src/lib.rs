extern crate parcel_js_swc_core;

use js_sys::Error;
use serde::ser::Serialize;
use serde_wasm_bindgen::{from_value, Serializer};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn transform(config_val: JsValue) -> Result<JsValue, JsValue> {
  let config: parcel_js_swc_core::Config = from_value(config_val).map_err(JsValue::from)?;

  let result = parcel_js_swc_core::transform(config)
    .map_err(|e| Error::from(JsValue::from_str(&e.to_string())))?;

  let serializer = Serializer::new().serialize_maps_as_objects(true);
  result.serialize(&serializer).map_err(JsValue::from)
}
