#![deny(unused_crate_dependencies)]

pub mod parcel;
pub use parcel::*;
pub use parcel_core::*;
pub use parcel_filesystem as file_system;

pub mod plugins {
  pub use parcel_plugin_resolver as resolver;
}
