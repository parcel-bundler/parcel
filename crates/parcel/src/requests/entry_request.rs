use std::hash::Hash;

use anyhow::anyhow;
use parcel_core::types::{Entry, EntryOption};

use crate::request_tracker::{Request, ResultAndInvalidations, RunRequestContext, RunRequestError};

use super::RequestResult;

/// A resolved entry file for the build
#[derive(Clone, Debug, Default, Hash, PartialEq)]
pub struct Entry {
  pub file_path: PathBuf,
  pub target: Option<String>,
}

/// The EntryRequest resolves an entry path or glob to the actual file location
#[derive(Debug, Hash)]
pub struct EntryRequest {
  pub entry: String,
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
    let mut entry_path = PathBuf::from(self.entry.clone());
    if entry_path.is_relative() {
      entry_path = request_context.project_root.join(entry_path);
    };

    if request_context.file_system().is_file(&entry_path) {
      return Ok(ResultAndInvalidations {
        result: RequestResult::Entry(EntryRequestOutput {
          entries: vec![Entry {
            file_path: entry_path,
            target: None,
          }],
        }),
        // TODO: invalidations
        invalidations: vec![],
      });
    }

    Err(anyhow!("Unknown entry: {}", self.entry))
  }
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use crate::test_utils::{request_tracker, RequestTrackerTestOptions};

  use super::*;

  #[test]
  fn returns_error_when_entry_is_not_found() {
    let request = EntryRequest {
      entry: String::from("src/a.js"),
    };

    let entry = request_tracker(RequestTrackerTestOptions::default()).run_request(request);

    assert_eq!(
      entry.map_err(|e| e.to_string()),
      Err(String::from("Unknown entry: src/a.js"))
    )
  }

  #[test]
  fn returns_file_entry_from_project_root() {
    let fs = Arc::new(InMemoryFileSystem::default());
    let project_root = PathBuf::from("parcel");
    let request = EntryRequest {
      entry: String::from("src/a.js"),
    };

    let entry_path = project_root.join("src").join("a.js");

    fs.write_file(&entry_path, String::default());

    let entry = request_tracker(RequestTrackerTestOptions {
      fs,
      project_root: project_root.clone(),
      ..RequestTrackerTestOptions::default()
    })
    .run_request(request);

    assert_eq!(
      entry.map_err(|e| e.to_string()),
      Ok(RequestResult::Entry(EntryRequestOutput {
        entries: vec![Entry {
          file_path: entry_path,
          target: None,
        }]
      }))
    );
  }

  #[test]
  fn returns_file_entry_from_root() {
    let fs = Arc::new(InMemoryFileSystem::default());

    #[cfg(not(target_os = "windows"))]
    let root = PathBuf::from(std::path::MAIN_SEPARATOR_STR);

    #[cfg(target_os = "windows")]
    let root = PathBuf::from("c:\\windows");

    let entry_path = root.join("src").join("a.js");
    let request = EntryRequest {
      entry: root.join("src/a.js").to_string_lossy().into_owned(),
    };

    fs.write_file(&entry_path, String::default());

    let entry = request_tracker(RequestTrackerTestOptions {
      fs,
      project_root: PathBuf::from("parcel"),
      ..RequestTrackerTestOptions::default()
    })
    .run_request(request);

    assert_eq!(
      entry.map_err(|e| e.to_string()),
      Ok(RequestResult::Entry(EntryRequestOutput {
        entries: vec![Entry {
          file_path: entry_path,
          target: None,
        }]
      }))
    );
  }
}
