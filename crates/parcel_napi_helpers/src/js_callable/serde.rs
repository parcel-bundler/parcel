use napi::bindgen_prelude::Array;
use napi::bindgen_prelude::FromNapiValue;
use napi::JsUnknown;
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::MapJsParams;
use super::MapJsReturn;

pub fn map_params_serde<Params>(params: Params) -> MapJsParams
where
  Params: Serialize + Send + Sync + 'static,
{
  Box::new(move |env| {
    let result = env.to_js_value(&params)?;
    if result.is_array()? {
      let result = Array::from_unknown(result)?;
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

pub fn map_return_serde<Return>() -> MapJsReturn<Return>
where
  Return: Send + DeserializeOwned + 'static,
{
  Box::new(move |env, value| env.from_js_value(&value))
}
