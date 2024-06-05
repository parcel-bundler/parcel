#[cfg(feature = "napi_bindings")]
mod napi;

#[cfg_attr(any, feature = "napi_bindings", feature = "nodejs")]
pub mod nodejs {
  pub use super::napi::*;
}

#[cfg_attr(any, feature = "napi_bindings", feature = "wasm")]
pub mod wasm {
  pub use super::napi::*;
}

mod resolver;
pub use resolver::*;
