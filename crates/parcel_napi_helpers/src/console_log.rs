use napi::Env;
use napi::JsFunction;
use napi::JsObject;
use napi::JsUndefined;
use napi::NapiRaw;

/// Logs napi values using the JavaScript console
///
/// This function can be used to debug what data the pointers actually refer to
///
pub fn console_log<T>(env: Env, args: &[T]) -> napi::Result<JsUndefined>
where
  T: NapiRaw,
{
  let console_object = env
    .get_global()?
    .get_named_property::<JsObject>("console")?;

  console_object
    .get_named_property_unchecked::<JsFunction>("log")?
    .call(Some(&console_object), args)?;

  env.get_undefined()
}
