use napi::*;

pub fn console_log<T>(env: Env, args: &[T]) -> napi::Result<JsUndefined>
where T: NapiRaw {
  let console_object = env
    .get_global()?
    .get_named_property::<JsObject>("console")?;

  console_object
    .get_named_property_unchecked::<JsFunction>("log")?
    .call(Some(&console_object), args)?;

  env.get_undefined()
}
