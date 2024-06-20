use std::panic;

use napi::bindgen_prelude::Array;
use napi::bindgen_prelude::FromNapiValue;
use napi::Env;
use napi::JsUnknown;
use napi::NapiRaw;
use serde::de::DeserializeOwned;
use serde::Serialize;

pub fn map_params_serde<Params: Serialize + Send + Sync + 'static>(
  params: Params,
) -> Box<dyn FnOnce(&Env) -> napi::Result<Vec<JsUnknown>> + Send + 'static> {
  Box::new(move |env| {
    let result = env.to_js_value(&params)?;
    if result.is_array()? {
      // SAFETY: type assertion above
      let result = panic::catch_unwind::<_, napi::Result<Array>>(|| unsafe {
        Array::from_napi_value(env.raw(), result.raw())
      })
      .map_err(|_| napi::Error::from_reason("Unable to cast to array"))??;

      let mut args = vec![];

      for index in 0..result.len() {
        let Some(item) = result.get::<JsUnknown>(index)? else {
          return Err(napi::Error::from_reason("Error calculating params"));
        };
        args.push(item)
      }

      Ok(args)
    } else {
      Ok(vec![result])
    }
  })
}

pub fn map_return_serde<Return: Send + DeserializeOwned + 'static>(
) -> Box<dyn Fn(&Env, JsUnknown) -> napi::Result<Return> + Send + 'static> {
  Box::new(move |env, value| env.from_js_value(&value))
}
