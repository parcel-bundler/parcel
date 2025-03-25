use napi::{Env, JsObject, JsUnknown};
use napi_derive::napi;

#[napi]
pub fn transform_html(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::TransformOptions = env.from_js_value(opts)?;
  let result = parcel_html::transform_html(options);
  env.to_js_value(&result)
}

#[napi]
pub fn package_html(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::PackageOptions = env.from_js_value(opts)?;
  let result = parcel_html::package_html(options)
    .map_err(|_| napi::Error::new(napi::Status::GenericFailure, "An unexpected error occurred"))?;
  env.to_js_value(&result)
}

#[napi]
pub fn optimize_html(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::OptimizeHtmlOptions = env.from_js_value(opts)?;
  let result = parcel_html::optimize_html(options)
    .map_err(|_| napi::Error::new(napi::Status::GenericFailure, "An unexpected error occurred"))?;
  env.to_js_value(&result)
}

#[napi]
pub fn transform_svg(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::TransformOptions = env.from_js_value(opts)?;
  let result = parcel_html::transform_svg(options);
  env.to_js_value(&result)
}

#[napi]
pub fn package_svg(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::PackageOptions = env.from_js_value(opts)?;
  let result = parcel_html::package_svg(options)
    .map_err(|_| napi::Error::new(napi::Status::GenericFailure, "An unexpected error occurred"))?;
  env.to_js_value(&result)
}

#[napi]
pub fn optimize_svg(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::OptimizeSvgOptions = env.from_js_value(opts)?;
  let result = parcel_html::optimize_svg(options)
    .map_err(|_| napi::Error::new(napi::Status::GenericFailure, "An unexpected error occurred"))?;
  env.to_js_value(&result)
}

#[napi]
pub fn svg_react(opts: JsObject, env: Env) -> napi::Result<JsUnknown> {
  let options: parcel_html::SvgReactOptions = env.from_js_value(opts)?;
  let result = parcel_html::svg_react(options)
    .map_err(|_| napi::Error::new(napi::Status::GenericFailure, "An unexpected error occurred"))?;
  env.to_js_value(&result)
}
