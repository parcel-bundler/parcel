use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;
use parcel_napi_helpers::anyhow_napi;

use crate::core::js_requests::request_options::project_root_from_options;
use crate::core::requests::asset_graph_request::run_asset_graph_request;
use crate::core::requests::asset_graph_request::AssetGraphRequest;
use crate::core::requests::asset_graph_request::RunAssetGraphRequestParams;
use crate::core::requests::request_api::js_request_api::JSRequestApi;

#[napi]
fn napi_run_asset_graph_request(
  env: Env,
  asset_graph_request: AssetGraphRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  let env = Rc::new(env);
  let _run_api = JSRequestApi::new(env.clone(), api);
  let project_root = project_root_from_options(&options)?;

  run_asset_graph_request(RunAssetGraphRequestParams {
    asset_graph_request: &asset_graph_request,
    project_root: &project_root,
  })
  .map_err(anyhow_napi)?;

  Ok(())
}
