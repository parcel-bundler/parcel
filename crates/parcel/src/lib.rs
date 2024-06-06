#![deny(unused_crate_dependencies)]

#[allow(dead_code)]
#[allow(unused_variables)]
mod napi;

pub mod parcel;
pub use parcel::*;
pub use parcel_filesystem as file_system;

#[allow(dead_code)]
mod plugins;
