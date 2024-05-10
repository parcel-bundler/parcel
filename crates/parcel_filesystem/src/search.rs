use std::path::Path;
use std::path::PathBuf;

use crate::FileSystem;

pub fn find_ancestor_file<P: AsRef<Path>>(
  fs: &impl FileSystem,
  filenames: Vec<String>,
  from: P,
  root: P,
) -> Option<PathBuf> {
  for dir in from.as_ref().ancestors() {
    // Break if we hit a node_modules directory
    if let Some(filename) = dir.file_name() {
      if filename == "node_modules" {
        break;
      }
    }

    for name in &filenames {
      let fullpath = dir.join(name);
      if fs.is_file(&fullpath) {
        return Some(fullpath);
      }
    }

    if dir == root.as_ref() {
      break;
    }
  }

  None
}
