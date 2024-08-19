use napi::bindgen_prelude::FromNapiValue;
use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUnknown;
use napi::NapiRaw;

/// Get an object field as a JSFunction. Will error out if the field is not present or isn't an
/// instance of the global `"Function"`.
///
/// ## Safety
/// Uses raw NAPI casts, but checks that object field is a function
pub fn get_function(env: &Env, js_object: &JsObject, field_name: &str) -> napi::Result<JsFunction> {
  let Some(method): Option<JsUnknown> = js_object.get(field_name)? else {
    return Err(napi::Error::from_reason(format!(
      "[napi] Method not found: {}",
      field_name
    )));
  };
  let function_class: JsUnknown = env.get_global()?.get_named_property("Function")?;
  let is_function = method.instanceof(function_class)?;
  if !is_function {
    return Err(napi::Error::from_reason(format!(
      "[napi] Method is not a function: {}",
      field_name
    )));
  }

  let method_fn = unsafe { JsFunction::from_napi_value(env.raw(), method.raw()) }?;
  Ok(method_fn)
}
