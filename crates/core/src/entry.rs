use std::path::PathBuf;

use crate::SourceLocation;

pub struct Entry {
  file_path: PathBuf,
  package_path: PathBuf,
  target: Option<String>,
  loc: Option<SourceLocation>,
}
