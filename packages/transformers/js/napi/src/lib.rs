extern crate napi;
#[macro_use]
extern crate napi_derive;
extern crate parcel_js_swc_core;

use napi::{CallContext, JsObject, JsUnknown, Result};

#[cfg(target_os = "macos")]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[js_function(1)]
fn transform(ctx: CallContext) -> Result<JsUnknown> {
  let opts = ctx.get::<JsObject>(0)?;
  let config: parcel_js_swc_core::Config = ctx.env.from_js_value(opts)?;

  let result = parcel_js_swc_core::transform(config)?;
  ctx.env.to_js_value(&result)
}

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("transform", transform)?;

  Ok(())
}
