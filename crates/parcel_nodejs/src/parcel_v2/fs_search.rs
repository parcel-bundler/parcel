use std::path::Path;

use napi_derive::napi;

#[napi]
pub fn find_ancestor_file(filenames: Vec<String>, from: String, root: String) -> Option<String> {
  let from = Path::new(&from);
  let root = Path::new(&root);

  for dir in from.ancestors() {
    // Break if we hit a node_modules directory
    if let Some(filename) = dir.file_name() {
      if filename == "node_modules" {
        break;
      }
    }

    for name in &filenames {
      let fullpath = dir.join(name);
      if fullpath.is_file() {
        return Some(fullpath.to_string_lossy().into_owned());
      }
    }

    if dir == root {
      break;
    }
  }

  None
}

#[napi]
pub fn find_first_file(names: Vec<String>) -> Option<String> {
  for name in names {
    let path = Path::new(&name);

    if path.is_file() {
      return Some(name);
    }
  }

  None
}

#[napi]
pub fn find_node_module(module: String, from: String) -> Option<String> {
  let module = Path::new(&module);
  let from = Path::new(&from);

  for dir in from.ancestors() {
    // Skip over node_modules directories
    if let Some(filename) = dir.file_name() {
      if filename == "node_modules" {
        continue;
      }
    }

    let fullpath = dir.join("node_modules").join(module);
    if fullpath.is_dir() {
      return Some(fullpath.to_string_lossy().into_owned());
    }
  }

  None
}
