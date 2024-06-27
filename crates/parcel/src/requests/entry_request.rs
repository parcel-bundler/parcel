use std::hash::Hash;
use std::path::PathBuf;

use anyhow::anyhow;

use crate::request_tracker::{Request, ResultAndInvalidations, RunRequestContext, RunRequestError};

use super::RequestResult;

/// The EntryRequest resolves an entry option to a file path, or list of file
/// paths if a glob or directory is specified.
#[derive(Debug, Hash)]
pub struct EntryRequest {
  pub entry: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
  file_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntryRequestOutput {
  pub entries: Vec<Entry>,
}

impl Request for EntryRequest {
  fn run(
    &self,
    request_context: RunRequestContext,
  ) -> Result<ResultAndInvalidations, RunRequestError> {
    // TODO: Handle globs and directories
    let mut entry_path = PathBuf::from("todo: project path");
    entry_path.push(self.entry.clone());

    if request_context.file_system().is_file(&entry_path) {
      Ok(ResultAndInvalidations {
        result: RequestResult::Entry(EntryRequestOutput {
          entries: vec![Entry {
            file_path: entry_path,
          }],
        }),
        // TODO: invalidations
        invalidations: vec![],
      })
    } else {
      Err(anyhow!("Invalid entry {}", self.entry))
    }
  }
}
