use napi::Env;
use napi::JsObject;
use napi::JsUnknown;

use crate::get_function;

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
