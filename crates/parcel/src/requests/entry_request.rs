use std::hash::Hash;

use anyhow::anyhow;
use parcel_core::types::{Entry, EntryOption};

use crate::request_tracker::{Request, ResultAndInvalidations, RunRequestContext, RunRequestError};

use super::RequestResult;

/// The EntryRequest resolves an entry option to a file path, or list of file
/// paths if a glob or directory is specified.
#[derive(Debug, Hash)]
pub struct EntryRequest {
  pub entry: EntryOption,
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
    let mut entry_path = request_context.options().project_root.clone();

    let EntryOption::Single(entry_option) = &self.entry else {
      todo!("Multiple entries");
    };

    entry_path.push(entry_option);

    if request_context.file_system().is_file(&entry_path) {
      Ok(ResultAndInvalidations {
        result: RequestResult::Entry(EntryRequestOutput {
          entries: vec![Entry {
            file_path: entry_path,
            target: None,
          }],
        }),
        // TODO: invalidations
        invalidations: vec![],
      })
    } else {
      Err(anyhow!("Invalid entry {:?}", self.entry))
    }
  }
}
