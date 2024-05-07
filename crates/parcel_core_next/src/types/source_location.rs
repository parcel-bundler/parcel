use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;

use super::Location;

#[derive(PartialEq, Debug, Clone, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
  pub file_path: PathBuf,
  pub start: Location,
  pub end: Location,
}
