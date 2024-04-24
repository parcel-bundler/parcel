use anyhow::Error;
use std::path::Path;

use napi_derive::napi;

use parcel_resolver::FileSystem;

use crate::core::project_path::ProjectPath;
use crate::core::requests::config_request::InternalFileCreateInvalidation;
use crate::core::requests::request_api::RequestApi;

#[napi(object)]
#[derive(Debug)]
pub struct Entry {
  pub file_path: ProjectPath,
  pub package_path: ProjectPath,
}

#[napi(object)]
#[derive(Debug, Default)]
pub struct EntryResult {
  pub entries: Vec<Entry>,
  pub files: Vec<ProjectPath>,
  pub globs: Vec<String>,
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
    todo!("glob entries are not implemented")
  } else if fs.is_file(path) {
    resolve_entry_file(ResolveEntryParams {
      path,
      fs,
      project_root,
    })?
  } else if fs.is_dir(path) {
    todo!("directory entries are not implemented")
  } else {
    todo!("invalid entry")
  }
}

/// Resolve an entrypoint that is a file
fn resolve_entry_file(
  ResolveEntryParams {
    path,
    fs,
    project_root,
  }: ResolveEntryParams<impl FileSystem>,
) -> Result<Result<EntryResult, Error>, Error> {
  let project_root = fs.canonicalize_base(project_root)?;
  let path = fs.canonicalize_base(path)?;
  let cwd = fs.cwd()?;
  let package_path = if project_root.starts_with(&cwd) {
    cwd
  } else {
    project_root
  };

  Ok(Ok(EntryResult {
    entries: vec![Entry {
      file_path: path.into(),
      package_path: package_path.into(),
    }],
    ..Default::default()
  }))
}

#[napi(object)]
struct EntryRequestInput {
  pub project_path: String,
}

pub struct RunEntryRequestParams<'a, RA: RequestApi, FS: FileSystem> {
  run_api: &'a RA,
  fs: &'a FS,
  input: &'a EntryRequestInput,
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
