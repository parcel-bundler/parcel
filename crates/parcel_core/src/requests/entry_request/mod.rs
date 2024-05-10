//! Entry request corresponds to `EntryRequest.js` and is used to resolve entry points.
//!
//! Effectively when we get an "entry"; we try to find it as a file, project
//! directory or glob, then resolve files
use std::path::Path;

use anyhow::anyhow;
use napi_derive::napi;
use parcel_resolver::FileSystem;

use crate::project_path::ProjectPath;
use crate::requests::config_request::InternalFileCreateInvalidation;
use crate::requests::request_api::RequestApi;

#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
  pub file_path: ProjectPath,
  pub package_path: ProjectPath,
}

#[napi(object)]
#[derive(Debug, Default, PartialEq)]
pub struct EntryResult {
  pub entries: Vec<Entry>,
  pub files: Vec<ProjectPath>,
  pub globs: Vec<String>,
}

fn merge_results(target: &mut EntryResult, source: EntryResult) {
  target.entries.extend(source.entries);
  target.files.extend(source.files);
  target.globs.extend(source.globs);
}

/// This function should check if a string is a glob pattern.
///
/// TODO: This is not a sufficient implementation
fn is_glob(path: &Path) -> bool {
  path.to_str().unwrap().contains("*")
}

/// Params object for resolve functions
struct ResolveEntryParams<'a, FS: FileSystem> {
  path: &'a Path,
  fs: &'a FS,
  project_root: &'a Path,
}

/// Resolve an entry-point
fn resolve_entry(
  ResolveEntryParams {
    path,
    fs,
    project_root,
  }: ResolveEntryParams<impl FileSystem>,
) -> anyhow::Result<EntryResult> {
  if is_glob(path) {
    resolve_entry_glob(ResolveEntryParams {
      path,
      fs,
      project_root,
    })
  } else if fs.is_file(path) {
    resolve_entry_file(ResolveEntryParams {
      path,
      fs,
      project_root,
    })
  } else if fs.is_dir(path) {
    todo!("directory entries are not implemented")
  } else {
    Err(anyhow!("[napi] Invalid entry, file not found"))
  }
}

/// Resolve an entry-point that is a glob by expanding the glob then resolving each of its matches.
fn resolve_entry_glob(
  ResolveEntryParams {
    path,
    fs,
    project_root,
  }: ResolveEntryParams<impl FileSystem>,
) -> anyhow::Result<EntryResult> {
  let pattern = path.to_str().unwrap();
  let results = glob::glob(pattern)?;
  let mut result = EntryResult::default();
  for path in results {
    let path = path?;
    merge_results(
      &mut result,
      resolve_entry(ResolveEntryParams {
        path: &path,
        fs,
        project_root,
      })?,
    );
  }
  Ok(result)
}

/// Resolve an entrypoint that is a file
fn resolve_entry_file(
  ResolveEntryParams {
    path,
    fs,
    project_root,
  }: ResolveEntryParams<impl FileSystem>,
) -> anyhow::Result<EntryResult> {
  let project_root = fs.canonicalize_base(project_root)?;
  let path = fs.canonicalize_base(path)?;
  let cwd = fs.cwd()?;
  // TODO: What is this for???? Why do we ignore project root depending on the CWD at this level?
  // Probably this is not the right place to handle this feature. Note that this is all this code
  // does so if this was handled at a CLI level we don't need any of this.
  let package_path = if project_root.starts_with(&cwd) {
    cwd
  } else {
    project_root
  };

  Ok(EntryResult {
    entries: vec![Entry {
      file_path: path.into(),
      package_path: package_path.into(),
    }],
    ..Default::default()
  })
}

#[napi(object)]
pub struct EntryRequestInput {
  pub project_path: String,
}

pub struct RunEntryRequestParams<'a, RA: RequestApi, FS: FileSystem> {
  pub run_api: &'a RA,
  pub fs: &'a FS,
  pub input: &'a EntryRequestInput,
}

/// Run entry-request. Corresponds to `EntryRequest.js`.
pub fn run_entry_request(
  RunEntryRequestParams { run_api, fs, input }: RunEntryRequestParams<
    impl RequestApi,
    impl FileSystem,
  >,
) -> anyhow::Result<EntryResult> {
  let result = resolve_entry(ResolveEntryParams {
    path: Path::new(&input.project_path),
    fs,
    project_root: Path::new(&input.project_path),
  })?;

  for file in &result.files {
    run_api.invalidate_on_file_update(file.as_ref())?;
    run_api.invalidate_on_file_delete(file.as_ref())?;
  }

  for glob in &result.globs {
    run_api.invalidate_on_file_create(&InternalFileCreateInvalidation {
      glob: Some(glob.clone()),
      ..Default::default()
    })?;
  }

  for entry in &result.entries {
    run_api.invalidate_on_file_delete(entry.file_path.as_ref())?;
  }

  Ok(result)
}

#[cfg(test)]
mod test {
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  #[test]
  fn test_merge_results() {
    let entry1 = Entry {
      file_path: ProjectPath::from("file1"),
      package_path: ProjectPath::from("package1"),
    };
    let file2 = ProjectPath::from("file2");
    let glob1 = "glob1".to_string();
    let mut result1 = EntryResult {
      entries: vec![entry1.clone()],
      files: vec![file2.clone()],
      globs: vec![glob1.clone()],
    };
    let entry2 = Entry {
      file_path: ProjectPath::from("file3"),
      package_path: ProjectPath::from("package2"),
    };
    let file4 = ProjectPath::from("file4");
    let glob2 = "glob2".to_string();
    let result2 = EntryResult {
      entries: vec![entry2.clone()],
      files: vec![file4.clone()],
      globs: vec![glob2.clone()],
    };

    merge_results(&mut result1, result2);
    assert_eq!(
      result1,
      EntryResult {
        entries: vec![entry1, entry2,],
        files: vec![file2, file4,],
        globs: vec![glob1, glob2,],
      }
    );
  }

  #[test]
  fn test_resolve_entry_file() {
    let mut fs = InMemoryFileSystem::default();
    fs.set_current_working_directory("/project".into());
    let project_root = Path::new("/project");
    let path = Path::new("/project/file");
    let result = resolve_entry_file(ResolveEntryParams {
      path,
      fs: &fs,
      project_root,
    });
    assert_eq!(
      result.unwrap(),
      EntryResult {
        entries: vec![Entry {
          file_path: ProjectPath::from("/project/file"),
          package_path: ProjectPath::from("/project"),
        }],
        ..Default::default()
      }
    );
  }
}
