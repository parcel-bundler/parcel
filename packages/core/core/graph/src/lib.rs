use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MyStruct {
  pub foo: i32,
}

#[wasm_bindgen]
pub fn get_my_struct() -> MyStruct {
  MyStruct { foo: 9 }
}

#[wasm_bindgen(js_name = "getMyNumber")]
pub fn get_my_number() -> i32 {
  7
}
