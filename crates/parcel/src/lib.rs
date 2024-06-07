#![deny(unused_crate_dependencies)]

#[allow(dead_code)]
#[allow(unused_variables)]
pub mod parcel;
pub use parcel::*;
pub use parcel_filesystem as file_system;

#[allow(dead_code)]
mod plugins;
