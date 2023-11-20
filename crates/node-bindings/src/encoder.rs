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

  Uint32Array::new(encoded)
}

#[napi]
pub fn decode(encoded: Uint32Array, mut decoded: Uint32Array) {
  let length = encoded.len();
  let mut i: usize = 0;
  let mut index: usize = 0;

  while i < length {
    let value: u32 = encoded[i];

    if value == 0 {
      index += encoded[i + 1] as usize;
      i += 2;
    } else {
      decoded[index] = value;
      index += 1;
      i += 1;
    }
  }
}
