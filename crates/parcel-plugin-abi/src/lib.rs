#![allow(non_camel_case_types)]

#[macro_use]
mod macros;
#[macro_use]
mod extensible;

mod api;
mod asset;
mod buffer;
mod bundle;
mod bundle_graph;
mod dependency;
mod diagnostic;
mod diagnostics;
mod entry_points;
mod fs;
mod handles;
/// cbindgen:ignore
pub mod manifest;
mod options;
mod plugin;
mod target;

pub use api::*;
pub use asset::*;
pub use buffer::*;
pub use bundle::*;
pub use bundle_graph::*;
pub use dependency::*;
pub use diagnostic::*;
pub use diagnostics::*;
pub use entry_points::*;
pub use fs::*;
pub use handles::*;
pub use options::*;
pub use plugin::*;
pub use target::*;

#[cfg(test)]
mod shim_tests;
#[cfg(test)]
mod tests;
