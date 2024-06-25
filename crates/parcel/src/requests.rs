use asset_request::AssetResult;
use path_request::PathResolution;

mod asset_request;
mod path_request;

#[derive(Clone, Debug, PartialEq)]
pub enum ParcelRequestResult {
  PathRequest(PathResolution),
  AssetRequest(AssetResult),
  // The following are test request types only used in the test build
  #[cfg(test)]
  SubRequest(String),
  #[cfg(test)]
  MainRequest(Vec<String>),
}
