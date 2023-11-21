use napi::bindgen_prelude::Uint32Array;
use napi_derive::napi;
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};

const MIN_CHUNK_SIZE: usize = 1000000;

#[napi]
pub fn encode(input: Uint32Array) -> Uint32Array {
  let mut input_vec: Vec<u32> = input.to_vec();

  // Remove all trailing 0's from the input
  let mut index = input_vec.len() - 1;
  while input_vec[index] == 0 {
    index -= 1;
  }
  input_vec.truncate(index + 1);

  let total_len = input_vec.len();

  let mut chunk_count = (total_len / MIN_CHUNK_SIZE) + 1;
  if chunk_count > rayon::current_num_threads() {
    chunk_count = rayon::current_num_threads();
  }

  let chunk_size = (total_len as f64 / chunk_count as f64).ceil() as usize;

  let encoded = (0..chunk_count)
    .collect::<Vec<usize>>()
    .par_iter()
    .map(|chunk| {
      let start = *chunk * chunk_size;
      let end = if *chunk == chunk_count - 1 {
        total_len
      } else {
        start + chunk_size
      };

      // To avoid resizing, pre-allocate the full chunk size capacity
      let mut encoded: Vec<u32> = Vec::with_capacity(chunk_size);
      let mut zero_run: u32 = 0;
      let mut non_zero_run = 0;
      let mut i = start;

      if i != 0 && input_vec[i - 1] == 0 {
        // Don't start with 0's as they are handled by the previous chunk
        while i < total_len && input_vec[i] == 0 {
          i += 1;
        }
      }

      while i < end {
        let value: u32 = input_vec[i];

        if value == 0 {
          zero_run += 1;

          if non_zero_run > 0 {
            let start_of_run = i - non_zero_run;
            encoded.extend_from_slice(&input_vec[start_of_run..i]);
            non_zero_run = 0;
          }
        } else {
          non_zero_run += 1;

          if zero_run > 0 {
            encoded.extend_from_slice(&[0, zero_run]);
            zero_run = 0;
          }
        }

        i += 1;
      }

      if non_zero_run > 0 {
        let start_of_run = i - non_zero_run;
        encoded.extend_from_slice(&input_vec[start_of_run..i]);
      }

      while zero_run > 0 {
        if i == total_len || input_vec[i] != 0 {
          encoded.extend_from_slice(&[0, zero_run]);
          break;
        }

        i += 1;
        zero_run += 1;
      }
      encoded
    })
    .flatten()
    .collect();

  Uint32Array::new(encoded)
}

#[napi]
pub fn decode(encoded: Uint32Array, mut decoded: Uint32Array) -> Uint32Array {
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

  decoded
}

#[cfg(test)]
mod tests {
  use crate::encoder::{decode, encode};
  use napi::bindgen_prelude::Uint32Array;

  #[test]
  fn encode_basic() {
    let values = vec![1, 2, 0, 0, 0, 2, 3, 4];
    let input = Uint32Array::new(values.clone());
    let encoded = encode(input);
    let result = encoded.to_vec();

    assert_eq!(vec![1, 2, 0, 3, 2, 3, 4], result);
  }

  #[test]
  fn encode_basic_with_trailing_zeros() {
    let values = vec![1, 2, 0, 0, 0, 2, 3, 4, 0, 0];
    let input = Uint32Array::new(values.clone());
    let encoded = encode(input);
    let result = encoded.to_vec();

    assert_eq!(vec![1, 2, 0, 3, 2, 3, 4], result);
  }

  #[test]
  fn encode_basic_with_leading_zeros() {
    let values = vec![0, 0, 1, 2, 0, 0, 0, 2, 3, 4];
    let input = Uint32Array::new(values.clone());
    let encoded = encode(input);
    let result = encoded.to_vec();

    assert_eq!(vec![0, 2, 1, 2, 0, 3, 2, 3, 4], result);
  }

  #[test]
  fn encode_decode_basic() {
    let values = vec![1, 2, 0, 0, 0, 0, 2, 3, 4];
    let input = Uint32Array::new(values.clone());

    let encoded = encode(input);

    let prefilled = vec![0; values.len()];
    let mut decoded = Uint32Array::new(prefilled);
    decoded = decode(encoded, decoded);

    let result = decoded.to_vec();
    assert_eq!(values, result);
  }

  #[test]
  fn encode_decode_with_trailing_zeros() {
    let values = vec![1, 2, 0, 0, 0, 0, 2, 3, 4, 0, 0];
    let input = Uint32Array::new(values.clone());

    let encoded = encode(input);

    let prefilled = vec![0; values.len()];
    let mut decoded = Uint32Array::new(prefilled);
    decoded = decode(encoded, decoded);

    let result = decoded.to_vec();
    assert_eq!(values, result);
  }

  #[test]
  fn encode_decode_with_leading_zeros() {
    let values = vec![0, 0, 1, 2, 0, 0, 0, 0, 2, 3, 4];
    let input: Uint32Array = Uint32Array::new(values.clone());

    let encoded = encode(input);

    let prefilled = vec![0; values.len()];
    let mut decoded = Uint32Array::new(prefilled);
    decoded = decode(encoded, decoded);

    let result = decoded.to_vec();
    assert_eq!(values, result);
  }

  #[test]
  fn encode_decode_large() {
    let values = vec![
      0, 0, 0, 1, 2, 0, 0, 0, 0, 2, 3, 4, 0, 2, 0, 0, 2, 3, 7, 20, 13, 0, 2, 3, 7, 20, 0, 2, 3, 4,
      0, 2, 0, 1, 2, 0, 0, 2, 3, 7, 20, 0, 2, 3, 4, 0, 2, 0, 0, 0, 2, 3, 4, 0, 2, 0, 0, 2, 3, 7, 0,
      20, 13, 0, 0, 2, 0, 1, 2, 0, 0, 2, 3, 7, 20, 0, 2, 3, 0, 2, 3, 4, 0, 2, 0, 0, 0, 0, 0, 0, 0,
    ];
    let input = Uint32Array::new(values.clone());

    let encoded = encode(input);

    let prefilled = vec![0; values.len()];
    let mut decoded = Uint32Array::new(prefilled);
    decoded = decode(encoded, decoded);

    let result = decoded.to_vec();
    assert_eq!(values, result);
  }
}
