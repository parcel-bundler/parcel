use std::path::Path;

use mockall::automock;

use crate::core::requests::config_request::InternalFileCreateInvalidation;

pub mod js_request_api;

// TODO: Move this into an associated type of the struct
pub type RequestApiResult<T> = napi::Result<T>;

/// RequestTracker API with the requests.
///
/// We will implement these as we need them. While working on integrating
/// with the existing JavaScript codebase, `JSRequestApi` will be used and will
/// delegate these calls into the JavaScript implementation.
///
/// `mockall::automock` also generates a `MockRequestApi` to be used internally.
#[automock]
pub trait RequestApi {
  /// Invalidate the current request when a file at `path` is updated
  fn invalidate_on_file_update(&self, path: &Path) -> RequestApiResult<()>;
  /// Invalidate the current request when a file at `path` is deleted
  fn invalidate_on_file_delete(&self, path: &Path) -> RequestApiResult<()>;
  /// Invalidate the current request when a file at `path` is created
  fn invalidate_on_file_create(
    &self,
    path: &InternalFileCreateInvalidation,
  ) -> RequestApiResult<()>;
  /// Invalidate the current request when a config key from the configuration
  /// file at path is changed
  fn invalidate_on_config_key_change(
    &self,
    file_path: &Path,
    config_key: &str,
    content_hash: &str,
  ) -> RequestApiResult<()>;
  /// Invalidate the current request on start-up
  fn invalidate_on_startup(&self) -> RequestApiResult<()>;
  /// Invalidate the current request on builds
  fn invalidate_on_build(&self) -> RequestApiResult<()>;
  /// Invalidate the current request on environment variable changes
  fn invalidate_on_env_change(&self, env_change: &str) -> RequestApiResult<()>;
  /// Invalidate the current request on option changes
  fn invalidate_on_option_change(&self, option: &str) -> RequestApiResult<()>;

  // Missing functions:
  // fn getInvalidations() -> Vec<RequestInvalidation>;
  // fn store_result(result: RequestResult, cacheKey: &str);
  // fn get_request_result<T>(contentKey: &str);
  // fn getPreviousResult<T>(ifMatch: string);
  // fn getSubRequests() -> Vec<RequestNode>;
  // fn getInvalidSubRequests() -> Vec<RequestNode>;
  // fn canSkipSubrequest(content_key: &str) -> bool;
  // fn runRequest(subRequest: Request<TInput, TResult>, opts?: RunRequestOpts, ) => Promise<TResult>,
}
