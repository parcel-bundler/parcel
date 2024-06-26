#[cfg(not(target_arch = "wasm32"))]
pub mod js_callable;

mod anyhow;
mod call_method;
mod console_log;
mod get_function;

pub use self::anyhow::*;
pub use self::call_method::*;
pub use self::console_log::*;
pub use self::get_function::*;
