use std::path::PathBuf;
use std::rc::Rc;

use napi::bindgen_prelude::External;
use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_config::parcel_rc_config_loader::LoadConfigOptions;
use parcel_config::parcel_rc_config_loader::ParcelRcConfigLoader;
use parcel_config::ParcelConfig;

use super::parcel_options::input_fs_from_options;
use super::parcel_options::package_manager_from_options;
use super::parcel_options::project_root_from_options;

#[napi(object)]
pub struct NapiConfig {
  pub config: ParcelConfig,
  pub extended_files: Vec<String>,
}

/// JavaScript API for retrieving a Parcel config.
#[napi]
pub fn napi_parcel_config(env: Env, options: JsObject) -> napi::Result<NapiConfig> {
  let env = Rc::new(env);

  let input_fs = input_fs_from_options(env.clone(), &options)?;
  let package_manager = package_manager_from_options(env, &options)?;

  let project_root = project_root_from_options(&options)?;
  let config = options.get("config").unwrap_or_default();
  let fallback_config = options.get("defaultConfig").unwrap_or_default();
  // let additional_reporters = options
  //   .get("additionalReporters")
  //   .unwrap_or_else(Vec::new())
  //   .unwrap();

  let result = ParcelRcConfigLoader::new(&input_fs, &package_manager).load(
    &project_root,
    LoadConfigOptions {
      additional_reporters: Vec::new(),
      config,
      fallback_config,
    },
  );

  match result {
    Ok((config, files)) => Ok(NapiConfig {
      config,
      extended_files: files
        .into_iter()
        .map(|f| String::from(f.into_os_string().into_string().unwrap()))
        .collect(),
    }),
    Err(err) => Err(napi::Error::from_reason(err.to_string())),
  }
}
