use asset_request::AssetRequestOutput;
use path_request::PathRequestOutput;
use target_request::TargetRequestOutput;

mod asset_request;
mod path_request;
mod target_request;

/// Union of all request outputs
#[derive(Clone, Debug, PartialEq)]
pub enum RequestResult {
  Path(PathRequestOutput),
  Asset(AssetRequestOutput),
  Target(TargetRequestOutput),
  // The following are test request types only used in the test build
  #[cfg(test)]
  TestSub(String),
  #[cfg(test)]
  TestMain(Vec<String>),
}
