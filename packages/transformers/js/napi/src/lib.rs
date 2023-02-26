use napi::{Env, JsObject, JsUnknown, Result};
use napi_derive::napi;

#[cfg(target_os = "macos")]
#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[cfg(windows)]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[napi]
pub fn transform(opts: JsObject, env: Env) -> Result<JsUnknown> {
  let config: parcel_js_swc_core::Config = env.from_js_value(opts)?;

  let result = parcel_js_swc_core::transform(config)?;
  env.to_js_value(&result)
}
