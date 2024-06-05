#[cfg(feature = "napi")]
pub mod hash_napi;

mod hash;
pub use hash::*;
