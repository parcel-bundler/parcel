use napi::bindgen_prelude::FromNapiValue;
use napi::{Env, JsFunction, JsObject, JsUnknown, NapiRaw};

/// Convert anyhow error to napi error
pub fn anyhow_napi(value: anyhow::Error) -> napi::Error {
  napi::Error::from_reason(format!("[napi] {}", value.to_string()))
}

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

/// Call a method on an object with a set of arguments.
///
/// Will error out if the method doesn't exist or if the field is not a function.
///
/// This does some redundant work ; so you may want to call `get_function`
/// directly if calling a method on a loop.
///
/// The function takes `JsUnknown` references so any type can be used as an
/// argument.
///
/// ## Safety
/// Uses raw NAPI casts, but checks that object field is a function
///
/// ## Example
/// ```skip
/// let string_parameter = env.create_string(path.to_str().unwrap())?;
/// let args = [&string_parameter.into_unknown()];
/// let field_name = "method";
///
/// call_method(&self.env, &js_object, field_name, &args)?;
/// ```
pub fn call_method(
  env: &Env,
  js_object: &JsObject,
  field_name: &str,
  args: &[&JsUnknown],
) -> napi::Result<JsUnknown> {
  let method_fn = get_function(env, js_object, field_name)?;
  let result = method_fn.call(Some(&js_object), &args)?;
  Ok(result)
}
