use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;

use anyhow::anyhow;
use parcel_filesystem::FileSystemRef;

use crate::request_tracker::{Request, RequestResult, RunRequestContext, RunRequestError};

/// The EntryRequest resolves an entry option to a file path, or list of file
/// paths if a glob or directory is specified.
pub struct EntryRequest {
  pub entry: String,
  // project_path: PathBuf,
  // file_system: FileSystemRef,
}

impl Hash for EntryRequest {
  fn hash<H: Hasher>(&self, state: &mut H) {
    // TODO: Just derive this once the contextual params are moved to RunRequestContext
    self.entry.hash(state);
  }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
  file_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EntryResult {
  pub entries: Vec<Entry>,
}

impl Request<EntryResult> for EntryRequest {
  fn run(
    &self,
    _request_context: RunRequestContext<EntryResult>,
  ) -> Result<RequestResult<EntryResult>, RunRequestError> {
    // TODO: Handle globs and directories
    let mut entry_path = self.project_path.clone();
    entry_path.push(self.entry.clone());

    if self.file_system.is_file(&entry_path) {
      Ok(RequestResult {
        result: EntryResult {
          entries: vec![Entry {
            file_path: entry_path,
          }],
        },
        // TODO: invalidations
        invalidations: vec![],
      })
    } else {
      Err(anyhow!("Invalid entry {}", self.entry))
    }
  }
}
