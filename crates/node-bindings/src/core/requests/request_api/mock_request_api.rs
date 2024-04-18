use std::path::Path;

use napi::Env;

use crate::core::requests::request_api::RequestApi;

pub struct MockRequestApi;

impl RequestApi for MockRequestApi {
  fn invalidate_on_file_update(&self, path: &Path) -> napi::Result<()> {
    Ok(())
  }

  fn invalidate_on_file_delete(&self, path: &Path) -> napi::Result<()> {
    Ok(())
  }

  fn invalidate_on_file_create(&self, path: &Path) -> napi::Result<()> {
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
