use xxhash_rust::xxh3::xxh3_64;

/// Copy of one of the `node-bindings/src/hash.rs` functions.
pub fn hash_string(s: String) -> String {
  let s = s.as_bytes();
  let res = xxh3_64(s);
  format!("{:016x}", res)
}
