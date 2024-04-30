use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;

use crate::core::js_helpers::anyhow_napi;
use crate::core::js_requests::request_options::project_root_from_options;
use crate::core::requests::asset_request::run_asset_request;
use crate::core::requests::asset_request::AssetRequest;
use crate::core::requests::asset_request::RunAssetRequestParams;
use crate::core::requests::request_api::js_request_api::JSRequestApi;
use crate::core::transformer::js_delegate_transformer::JSDelegateTransformer;

#[napi]
fn napi_run_asset_request(
  env: Env,
  asset_request: AssetRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  let env = Rc::new(env);
  let run_api = JSRequestApi::new(env.clone(), api);
  let project_root = project_root_from_options(&options)?;

  let transformer = JSDelegateTransformer::new(
    env,
    options.get("transformer")?.ok_or(napi::Error::from_reason(
      "[napi] Missing required option 'transformer'",
    ))?,
  );

  let result = run_asset_request(RunAssetRequestParams {
    asset_request,
    run_api: &run_api,
    project_root: &project_root,
    transformer: &transformer,
  })
  .map_err(anyhow_napi)?;

  Ok(result)
}
