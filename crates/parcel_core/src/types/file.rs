use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct File {
  pub contents: String,
  pub path: PathBuf,
}
