/*
  This module contains the interfaces/traits for plugins.

  It also contains the implementations for the built-in plugins

  It also contains the implementations for the dynamically loaded plugins
*/
mod transformer;
pub mod transformer_dyn_napi;
pub mod transformer_js_default;

pub use self::transformer::*;
