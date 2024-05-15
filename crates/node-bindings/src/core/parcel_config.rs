use std::path::PathBuf;
use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi::JsUnknown;
use napi_derive::napi;
use parcel_config::parcel_rc_config_loader::LoadConfigOptions;
use parcel_config::parcel_rc_config_loader::ParcelRcConfigLoader;
use parcel_config::PluginNode;

use super::parcel_options::additional_reporters_from_options;
use super::parcel_options::input_fs_from_options;
use super::parcel_options::package_manager_from_options;
use super::parcel_options::project_root_from_options;

/// JavaScript API for retrieving a Parcel config.
#[napi]
pub fn napi_parcel_config(env: Env, options: JsObject) -> napi::Result<JsUnknown> {
  let env = Rc::new(env);

  let input_fs = input_fs_from_options(env.clone(), &options)?;
  let package_manager = package_manager_from_options(env.clone(), &options)?;

  let additional_reporters = additional_reporters_from_options(&options)?;
  let config = options.get("config").unwrap_or_default();
  let fallback_config = options.get("defaultConfig").unwrap_or_default();
  let project_root = project_root_from_options(&options)?;

  let result = ParcelRcConfigLoader::new(&input_fs, &package_manager).load(
    &project_root,
    LoadConfigOptions {
      additional_reporters: additional_reporters
        .into_iter()
        .map(|r| PluginNode {
          package_name: r.package_name,
          resolve_from: Rc::new(PathBuf::from(r.resolve_from)),
        })
        .collect(),
      config,
      fallback_config,
    },
  );

  match result {
    Ok(result) => Ok(env.to_js_value(&result).unwrap()),
    Err(err) => Err(napi::Error::from_reason(err.to_string())),
  }
}
