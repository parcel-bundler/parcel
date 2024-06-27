use asset_request::AssetRequestOutput;
use path_request::PathRequestOutput;
use target_request::TargetRequestOutput;

pub mod asset_request;
pub mod path_request;
pub mod target_request;

/// Union of all request outputs
#[derive(Clone, Debug, PartialEq, rkyv::Archive, rkyv::Deserialize, rkyv::Serialize)]
#[archive(check_bytes)]
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
