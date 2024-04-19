use std::path::Path;

use napi_derive::napi;

use parcel_resolver::FileSystem;

use crate::core::requests::request_api::RequestApi;

pub type ProjectPath = String;

pub type InternalGlob = String;

#[napi(object)]
pub struct ConfigKeyChange {
  pub file_path: ProjectPath,
  pub config_key: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct InternalFileCreateInvalidation {
  // file
  pub file_path: Option<ProjectPath>,
  // glob
  pub glob: Option<InternalGlob>,
  // file above
  pub file_name: Option<String>,
  pub above_file_path: Option<ProjectPath>,
}

#[napi(object)]
pub struct ConfigRequest {
  pub id: String,
  // Set<...>
  pub invalidate_on_file_change: Vec<ProjectPath>,
  pub invalidate_on_config_key_change: Vec<ConfigKeyChange>,
  pub invalidate_on_file_create: Vec<InternalFileCreateInvalidation>,
  // Set<...>
  pub invalidate_on_env_change: Vec<String>,
  // Set<...>
  pub invalidate_on_option_change: Vec<String>,
  pub invalidate_on_startup: bool,
  pub invalidate_on_build: bool,
}

fn get_config_key_content_hash(
  file_path: &str,
  config_key: &str,
  input_fs: &impl FileSystem,
  project_root: &str,
) -> napi::Result<String> {
  todo!("")
}

pub fn run_config_request(
  config_request: &ConfigRequest,
  api: &impl RequestApi,
  input_fs: &impl FileSystem,
  project_root: &str,
) -> napi::Result<()> {
  for file_path in &config_request.invalidate_on_file_change {
    let file_path = Path::new(file_path);
    api.invalidate_on_file_update(file_path)?;
    api.invalidate_on_file_delete(file_path)?;
  }

  for config_key_change in &config_request.invalidate_on_config_key_change {
    let content_hash = get_config_key_content_hash(
      &config_key_change.file_path,
      &config_key_change.config_key,
      input_fs,
      &project_root,
    )?;
    api.invalidate_on_config_key_change(
      Path::new(&config_key_change.file_path),
      &config_key_change.config_key,
      &content_hash,
    )?;
  }

  for invalidation in &config_request.invalidate_on_file_create {
    api.invalidate_on_file_create(invalidation)?;
  }

  for env in &config_request.invalidate_on_env_change {
    api.invalidate_on_env_change(env)?;
  }

  for option in &config_request.invalidate_on_option_change {
    api.invalidate_on_option_change(option)?;
  }

  if config_request.invalidate_on_startup {
    api.invalidate_on_startup()?;
  }

  if config_request.invalidate_on_build {
    api.invalidate_on_build()?;
  }

  Ok(())
}

#[napi(object)]
struct RequestOptions {}

#[cfg(test)]
mod test {
  use parcel_resolver::OsFileSystem;

  use crate::core::requests::config_request::run_config_request;
  use crate::core::requests::request_api::MockRequestApi;

  use super::*;

  #[test]
  fn test_run_config_request() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: false,
      invalidate_on_build: false,
    };
    let request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap()
  }
}
