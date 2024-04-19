use std::path::Path;
use std::rc::Rc;

use napi::{Env, JsObject};
use requests::get_function;

use crate::core::requests;
use crate::core::requests::request_api::RequestApi;

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
  fn invalidate_on_file_update(&self, path: &Path) -> napi::Result<()> {
    let field_name = "invalidateOnFileUpdate";
    let method_fn = get_function(&self.env, &self.js_object, field_name)?;
    let path_js_string = self.env.create_string(path.to_str().unwrap())?;
    method_fn.call(Some(&self.js_object), &[&path_js_string])?;

    Ok(())
  }

  fn invalidate_on_file_delete(&self, path: &Path) -> napi::Result<()> {
    // ...
    Ok(())
  }

  fn invalidate_on_file_create(&self, path: &Path) -> napi::Result<()> {
    // ...
    Ok(())
  }

  fn invalidate_on_config_key_change(
    &self,
    file_path: &Path,
    config_key: &str,
    content_hash: &str,
  ) -> napi::Result<()> {
    Ok(())
  }

  fn invalidate_on_startup(&self, env: Env) -> napi::Result<()> {
    Ok(())
  }

  fn invalidate_on_build(&self, env: Env) -> napi::Result<()> {
    Ok(())
  }

  fn invalidate_on_env_change(&self, env_change: &str) -> napi::Result<()> {
    Ok(())
  }

  fn invalidate_on_option_change(&self, option: &str) -> napi::Result<()> {
    Ok(())
  }
}
