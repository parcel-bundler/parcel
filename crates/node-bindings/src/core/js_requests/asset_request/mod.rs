use crate::core::requests::asset_request::AssetRequest;
use napi::{Env, JsObject};
use napi_derive::napi;

#[napi]
fn napi_run_asset_request(
  env: Env,
  asset_request: AssetRequest,
  api: JsObject,
  options: JsObject,
) -> napi::Result<()> {
  todo!("RUN ASSET REQUEST")
}
