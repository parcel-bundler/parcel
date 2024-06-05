#[cfg(feature = "napi_bindings")]
mod hash_napi;

#[cfg(feature = "nodejs")]
pub mod nodejs {
  pub use super::hash_napi::*;
}

#[cfg(feature = "wasm")]
pub mod wasm {
  pub use super::hash_napi::*;
}

mod hash;
pub use hash::*;
