use std::future::Future;
use std::future::IntoFuture;
use std::rc::Rc;

use napi::bindgen_prelude::External;
use napi::tokio;
use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_config::parcel_rc_config_loader::LoadConfigOptions;
use parcel_config::parcel_rc_config_loader::ParcelRcConfigLoader;
use parcel_config::ParcelConfig;

use super::parcel_options::input_fs_from_options;
use super::parcel_options::package_manager_from_options;
use super::parcel_options::project_root_from_options;

/// JavaScript API for retrieving a Parcel config.
#[napi]
pub fn napi_parcel_config(env: Env, options: JsObject) -> napi::Result<JsObject> {
  let env = Rc::new(env);

  let input_fs = input_fs_from_options(env.clone(), &options)?;
  let package_manager = package_manager_from_options(env, &options)?;

  let project_root = project_root_from_options(&options)?;
  let (deferred, promise) = env.create_deferred()?;
  // let additional_reporters = options
  //   .get("additionalReporters")
  //   .unwrap_or_else(Vec::new())
  //   .unwrap();

  tokio::spawn(async move {
    let (config, files) = ParcelRcConfigLoader::new(&input_fs, &package_manager)
      .load(
        &project_root,
        LoadConfigOptions {
          additional_reporters: Vec::new(),
          config: options.get("config").unwrap_or_default(),
          fallback_config: options.get("defaultConfig").unwrap_or_default(),
        },
      )
      .await
      .map_err(|error| napi::Error::from_reason(error.to_string()))
      .unwrap();

    deferred.resolve(move |env| env.to_js_value(&config));
  });

  Ok(promise)

  // Ok(External::new(config))
}
