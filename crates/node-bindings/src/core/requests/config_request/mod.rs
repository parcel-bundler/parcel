//! Implements the `ConfigRequest` execution in rust.
//!
//! This is a rewrite of the `packages/core/core/src/requests/ConfigRequest.js`
//! file.
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
#[derive(Clone, PartialEq)]
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

/// Read a TOML or JSON configuration file as a value and return it
fn read_config(input_fs: &impl FileSystem, config_path: &Path) -> napi::Result<serde_json::Value> {
  let contents = input_fs.read_to_string(config_path)?;
  let Some(extension) = config_path.extension().map(|ext| ext.to_str()).flatten() else {
    // TODO: current JS behaviour might be to read it as JSON
    return Err(napi::Error::from_reason(
      "Configuration file has no extension or extension isn't unicode",
    ));
  };
  let contents = match extension {
    "json" => serde_json::from_str(&contents)
      .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string())),
    "toml" => toml::from_str(&contents)
      .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string())),
    extension => Err(napi::Error::from_reason(format!(
      "Invalid configuration format: {}",
      extension
    ))),
  }?;

  Ok(contents)
}

/// Hash a `serde_json::Value`. This does not do special handling yet, but
/// it should match the parcel utils implementation. That implementation
fn hash_serde_value(value: &serde_json::Value) -> anyhow::Result<String> {
  // TODO: this doesn't handle sorting keys
  Ok(crate::hash::hash_string(serde_json::to_string(value)?))
}

/// Hash a certain key in a configuration file.
fn get_config_key_content_hash(
  config_key: &str,
  input_fs: &impl FileSystem,
  project_root: &str,
  file_path: &str,
) -> napi::Result<String> {
  let mut path = Path::new(project_root).to_path_buf();
  path.push(file_path);

  let contents = read_config(input_fs, &path)?;

  let Some(config_value) = contents.get(config_key) else {
    // TODO: need to try to match behaviour of `ConfigRequest.js`
    return Ok("".to_string());
  };

  let content_hash =
    hash_serde_value(config_value).map_err(|err| napi::Error::from_reason(err.to_string()))?;
  Ok(content_hash)
}

/// A config request triggers several invalidations to be tracked.
///
/// This is ported to rust to serve as an example of Parcel requests being ported.
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
      &config_key_change.config_key,
      input_fs,
      &project_root,
      &config_key_change.file_path,
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
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use parcel_filesystem::os_file_system::OsFileSystem;

  use super::*;
  use crate::core::requests::config_request::run_config_request;
  use crate::core::requests::request_api::MockRequestApi;

  #[test]
  fn test_run_empty_config_request_does_nothing() {
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
    // The mock will panic if it's called with no mock set
    let request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_run_config_request_with_invalidate_on_file_change() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec!["path1".to_string(), "path2".to_string()],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: false,
      invalidate_on_build: false,
    };
    // The mock will panic if it's called with no mock set
    let mut request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    request_api
      .expect_invalidate_on_file_update()
      .times(2)
      .withf(|p| p.to_str().unwrap() == "path1" || p.to_str().unwrap() == "path2")
      .returning(|_| Ok(()));
    request_api
      .expect_invalidate_on_file_delete()
      .times(2)
      .withf(|p| p.to_str().unwrap() == "path1" || p.to_str().unwrap() == "path2")
      .returning(|_| Ok(()));

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_run_config_request_with_invalidate_on_file_create() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![InternalFileCreateInvalidation {
        file_path: Some("path1".to_string()),
        glob: None,
        file_name: None,
        above_file_path: None,
      }],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: false,
      invalidate_on_build: false,
    };
    // The mock will panic if it's called with no mock set
    let mut request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    request_api
      .expect_invalidate_on_file_create()
      .times(1)
      .withf(|p| {
        *p == InternalFileCreateInvalidation {
          file_path: Some("path1".to_string()),
          glob: None,
          file_name: None,
          above_file_path: None,
        }
      })
      .returning(|_| Ok(()));

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_run_config_request_with_invalidate_on_env_change() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec!["env1".to_string()],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: false,
      invalidate_on_build: false,
    };
    // The mock will panic if it's called with no mock set
    let mut request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    request_api
      .expect_invalidate_on_env_change()
      .times(1)
      .withf(|p| p == "env1")
      .returning(|_| Ok(()));

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_run_config_request_with_invalidate_on_option_change() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec!["option1".to_string()],
      invalidate_on_startup: false,
      invalidate_on_build: false,
    };
    // The mock will panic if it's called with no mock set
    let mut request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    request_api
      .expect_invalidate_on_option_change()
      .times(1)
      .withf(|p| p == "option1")
      .returning(|_| Ok(()));

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_run_config_request_with_invalidate_on_startup() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: true,
      invalidate_on_build: false,
    };
    // The mock will panic if it's called with no mock set
    let mut request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    request_api
      .expect_invalidate_on_startup()
      .times(1)
      .returning(|| Ok(()));

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_run_config_request_with_invalidate_on_build() {
    let config_request = ConfigRequest {
      id: "".to_string(),
      invalidate_on_file_change: vec![],
      invalidate_on_config_key_change: vec![],
      invalidate_on_file_create: vec![],
      invalidate_on_env_change: vec![],
      invalidate_on_option_change: vec![],
      invalidate_on_startup: false,
      invalidate_on_build: true,
    };
    // The mock will panic if it's called with no mock set
    let mut request_api = MockRequestApi::new();
    let file_system = OsFileSystem::default();
    let project_root = "";

    request_api
      .expect_invalidate_on_build()
      .times(1)
      .returning(|| Ok(()));

    run_config_request(&config_request, &request_api, &file_system, project_root).unwrap();
  }

  #[test]
  fn test_read_json_config() {
    let mut file_system = InMemoryFileSystem::default();
    let config_path = Path::new("/config.json");
    file_system.write_file(config_path, String::from(r#"{"key": "value"}"#));

    let contents = read_config(&file_system, config_path).unwrap();
    assert_eq!(contents, serde_json::json!({"key": "value"}));
  }

  #[test]
  fn test_read_toml_config() {
    let mut file_system = InMemoryFileSystem::default();
    let config_path = Path::new("/config.toml");
    file_system.write_file(config_path, String::from(r#"key = "value""#));

    let contents = read_config(&file_system, config_path).unwrap();
    assert_eq!(contents, serde_json::json!({"key": "value"}));
  }

  #[test]
  fn test_hash_serde_value() {
    let value = serde_json::json!({"key": "value", "key2": "value2"});
    let hash = hash_serde_value(&value).unwrap();
    assert_eq!(hash, "17666ca1af93de5d".to_string());
  }
}
