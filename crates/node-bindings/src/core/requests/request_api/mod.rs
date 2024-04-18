use std::path::Path;

use napi::Env;

pub mod js_request_api;
pub mod mock_request_api;

pub trait RequestApi {
  fn invalidate_on_file_update(&self, path: &Path) -> napi::Result<()>;
  fn invalidate_on_file_delete(&self, path: &Path) -> napi::Result<()>;
  fn invalidate_on_file_create(&self, path: &Path) -> napi::Result<()>;
  fn invalidate_on_config_key_change(
    &self,
    file_path: &Path,
    config_key: &str,
    content_hash: &str,
  ) -> napi::Result<()>;
  fn invalidate_on_startup(&self, env: Env) -> napi::Result<()>;
  fn invalidate_on_build(&self, env: Env) -> napi::Result<()>;
  fn invalidate_on_env_change(&self, env_change: &str) -> napi::Result<()>;
  fn invalidate_on_option_change(&self, option: &str) -> napi::Result<()>;
  // fn getInvalidations() -> Vec<RequestInvalidation>;
  // fn store_result(result: RequestResult, cacheKey: &str);
  // fn get_request_result<T>(contentKey: &str);
  // fn getPreviousResult<T>(ifMatch: string);
  // fn getSubRequests() -> Vec<RequestNode>;
  // fn getInvalidSubRequests() -> Vec<RequestNode>;
  // fn canSkipSubrequest(content_key: &str) -> bool;
  // fn runRequest(subRequest: Request<TInput, TResult>, opts?: RunRequestOpts, ) => Promise<TResult>,
}
