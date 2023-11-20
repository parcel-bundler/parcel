#![allow(clippy::new_without_default)]

use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;

#[napi]
pub fn encode(input: Uint32Array) -> Uint32Array {
  let mut encoded: Vec<u32> = vec![];
  let mut run_length: u32 = 0;

  for i in 0..input.len() {
    let value = input[i];

    if value == 0 {
      run_length += 1;
      continue;
    }

    if run_length > 0 {
      encoded.push(0);
      encoded.push(run_length);
      run_length = 0;
    }

    encoded.push(value);
  }

  return Uint32Array::new(encoded);
}

#[napi]
pub fn decode(input: Uint32Array) -> Uint32Array {
  input
}
