use asset_request::AssetResult;
use path_request::PathResolution;

mod asset_request;
mod path_request;

#[derive(Clone, Debug, PartialEq)]
pub enum RequestResult {
  Path(PathResolution),
  Asset(AssetResult),
  // The following are test request types only used in the test build
  #[cfg(test)]
  Sub(String),
  #[cfg(test)]
  Main(Vec<String>),
}
mod target_request;
