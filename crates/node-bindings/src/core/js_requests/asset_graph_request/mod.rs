use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;

use crate::core::js_requests::request_options::project_root_from_options;
use crate::core::requests::request_api::js_request_api::JSRequestApi;

#[napi(object)]
struct AssetGraphRequest {}

#[napi]
fn napi_run_asset_graph_request(
  env: Env,
  asset_graph_request: AssetGraphRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  let env = Rc::new(env);
  let run_api = JSRequestApi::new(env.clone(), api);
  let project_root = project_root_from_options(&options)?;

  todo!("Implement napi_run_asset_graph_request")
}
