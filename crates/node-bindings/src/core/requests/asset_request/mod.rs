use std::path::Path;

use napi_derive::napi;

use crate::core::project_path::ProjectPath;
use crate::core::requests::request_api::RequestApi;
use crate::core::transformer::{TransformationInput, Transformer};

#[napi(object)]
pub struct AssetRequest {
  pub file_path: ProjectPath,
}

pub struct RunAssetRequestParams<'a, RA: RequestApi, T: Transformer> {
  pub asset_request: AssetRequest,
  pub run_api: &'a RA,
  pub project_root: &'a str,
  pub transformer: &'a T,
}

pub fn run_asset_request(
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
