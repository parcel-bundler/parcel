use std::rc::Rc;

use napi::Env;
use napi::JsObject;
use napi_derive::napi;

use crate::core::js_requests::request_options::project_root_from_options;
use crate::core::requests::asset_graph_request::AssetGraphRequest;
use crate::core::requests::request_api::js_request_api::JSRequestApi;

#[napi]
fn napi_run_asset_graph_request(
  env: Env,
  #[allow(unused)] asset_graph_request: AssetGraphRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  let env = Rc::new(env);
  #[allow(unused)]
  let run_api = JSRequestApi::new(env.clone(), api);
  #[allow(unused)]
  let project_root = project_root_from_options(&options)?;

  todo!("Implement napi_run_asset_graph_request")
}
