use mockall::automock;
use napi_derive::napi;
use std::path::Path;

use crate::core::project_path::ProjectPath;
use crate::core::requests::config_request::InternalFileCreateInvalidation;

use crate::core::requests::request_api::RequestApi;

#[napi(object)]
pub struct AssetRequest {
  pub file_path: ProjectPath,
}

pub struct TransformationInput {
  file_path: ProjectPath,
}

#[napi(object)]
pub struct AssetValue {
  pub id: String,
}

/// TODO consolidate with config request
#[napi(object)]
pub struct TransformationInvalidations {
  pub invalidate_on_file_change: Vec<String>,
  pub invalidate_on_file_create: Vec<InternalFileCreateInvalidation>,
  pub invalidate_on_env_change: Vec<String>,
  pub invalidate_on_option_change: Vec<String>,
  pub invalidate_on_startup: bool,
  pub invalidate_on_build: bool,
}

#[napi(object)]
pub struct TransformationResult {
  pub assets: Vec<AssetValue>,
  pub invalidations: TransformationInvalidations,
}

#[automock]
pub trait Transformer {
  fn transform(&self, input: TransformationInput) -> anyhow::Result<TransformationResult>;
}

struct RunAssetRequestParams<'a, RA, T> {
  asset_request: AssetRequest,
  run_api: &'a RA,
  project_root: &'a str,
  transformer: &'a T,
}

fn run_asset_request(
  RunAssetRequestParams {
    asset_request,
    run_api,
    project_root: _project_root,
    transformer,
  }: RunAssetRequestParams<impl RequestApi, impl Transformer>,
) -> anyhow::Result<()> {
  run_api.invalidate_on_file_update(asset_request.file_path.as_ref())?;
  let input = TransformationInput {
    file_path: asset_request.file_path,
  };
  let result = transformer.transform(input)?;

  for file in result.invalidations.invalidate_on_file_change {
    let path = Path::new(&file);
    run_api.invalidate_on_file_update(path)?;
    run_api.invalidate_on_file_delete(path)?;
  }

  for file in result.invalidations.invalidate_on_file_create {
    run_api.invalidate_on_file_create(&file)?;
  }

  for env in result.invalidations.invalidate_on_env_change {
    run_api.invalidate_on_env_change(&env)?;
  }

  for option in result.invalidations.invalidate_on_option_change {
    run_api.invalidate_on_option_change(&option)?;
  }

  if result.invalidations.invalidate_on_startup {
    run_api.invalidate_on_startup()?;
  }

  if result.invalidations.invalidate_on_build {
    run_api.invalidate_on_build()?;
  }

  Ok(())
}

#[cfg(test)]
mod test {}
