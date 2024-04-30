use std::path::Path;
use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi::JsUnknown;

use crate::core::requests::call_method;
use crate::core::requests::config_request::InternalFileCreateInvalidation;
use crate::core::requests::request_api::RequestApi;
use crate::core::requests::request_api::RequestApiResult;

pub struct JSRequestApi {
  // TODO: Make sure it is safe to hold the environment like this
  env: Rc<Env>,
  js_object: JsObject,
}

impl JSRequestApi {
  pub fn new(env: Rc<Env>, js_object: JsObject) -> Self {
    Self { env, js_object }
  }
}

impl RequestApi for JSRequestApi {
  fn invalidate_on_file_update(&self, path: &Path) -> RequestApiResult<()> {
    let path_js_string = self.env.create_string(path.to_str().unwrap())?;
    call_method(
      &self.env,
      &self.js_object,
      "invalidateOnFileUpdate",
      &[&path_js_string.into_unknown()],
    )?;
    Ok(())
  }

  fn invalidate_on_file_delete(&self, path: &Path) -> RequestApiResult<()> {
    let path_js_string = self.env.create_string(path.to_str().unwrap())?;
    call_method(
      &self.env,
      &self.js_object,
      "invalidateOnFileDelete",
      &[&path_js_string.into_unknown()],
    )?;
    Ok(())
  }

  fn invalidate_on_file_create(
    &self,
    invalidation: &InternalFileCreateInvalidation,
  ) -> RequestApiResult<()> {
    use napi::bindgen_prelude::ToNapiValue;
    use napi::NapiValue;

    let js_invalidation = unsafe {
      JsUnknown::from_raw(
        self.env.raw(),
        ToNapiValue::to_napi_value(self.env.raw(), invalidation.clone())?,
      )
    }?;
    call_method(
      &self.env,
      &self.js_object,
      "invalidateOnFileCreate",
      &[&js_invalidation],
    )?;
    Ok(())
  }

  fn invalidate_on_config_key_change(
    &self,
    file_path: &Path,
    config_key: &str,
    content_hash: &str,
  ) -> RequestApiResult<()> {
    let path_js_string = self.env.create_string(file_path.to_str().unwrap())?;
    let config_key_js_string = self.env.create_string(config_key)?;
    let content_hash_js_string = self.env.create_string(content_hash)?;
    call_method(
      &self.env,
      &self.js_object,
      "invalidateOnConfigKeyChange",
      &[
        &path_js_string.into_unknown(),
        &config_key_js_string.into_unknown(),
        &content_hash_js_string.into_unknown(),
      ],
    )?;
    Ok(())
  }

  fn invalidate_on_startup(&self) -> RequestApiResult<()> {
    call_method(&self.env, &self.js_object, "invalidateOnStartup", &[])?;
    Ok(())
  }

  fn invalidate_on_build(&self) -> RequestApiResult<()> {
    call_method(&self.env, &self.js_object, "invalidateOnBuild", &[])?;
    Ok(())
  }

  fn invalidate_on_env_change(&self, env_change: &str) -> RequestApiResult<()> {
    let env_change_js_string = self.env.create_string(env_change)?;
    call_method(
      &self.env,
      &self.js_object,
      "invalidateOnEnvChange",
      &[&env_change_js_string.into_unknown()],
    )?;
    Ok(())
  }

  fn invalidate_on_option_change(&self, option: &str) -> RequestApiResult<()> {
    let option_js_string = self.env.create_string(option)?;
    call_method(
      &self.env,
      &self.js_object,
      "invalidateOnOptionChange",
      &[&option_js_string.into_unknown()],
    )?;
    Ok(())
  }
}
