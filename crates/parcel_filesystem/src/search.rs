use std::path::Path;
use std::path::PathBuf;

use crate::FileSystem;

#[derive(Debug)]
pub enum Entry<'a> {
  Directory(&'a str),
  File(&'a str),
}

pub fn find_ancestor<'a, P: AsRef<Path>>(
  fs: &dyn FileSystem,
  entries: &[Entry<'a>],
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

    for entry in entries {
      match entry {
        Entry::Directory(dirname) => {
          let fullpath = dir.join(dirname);
          if fs.is_dir(&fullpath) {
            return Some(fullpath);
          }
        }
        Entry::File(filename) => {
          let fullpath = dir.join(filename);
          if fs.is_file(&fullpath) {
            return Some(fullpath);
          }
        }
      };
    }

    if dir == root.as_ref() {
      break;
    }
  }

  None
}

pub fn find_ancestor_directory<P: AsRef<Path>>(
  fs: &dyn FileSystem,
  dirnames: &[&str],
  from: P,
  root: P,
) -> Option<PathBuf> {
  let entries: Vec<Entry> = dirnames.iter().map(|d| Entry::Directory(d)).collect();

  find_ancestor(fs, &entries, from, root)
}

pub fn find_ancestor_file<P: AsRef<Path>>(
  fs: &dyn FileSystem,
  filenames: &[&str],
  from: P,
  root: P,
) -> Option<PathBuf> {
  let entries: Vec<Entry> = filenames.iter().map(|d| Entry::File(d)).collect();

  find_ancestor(fs, &entries, from, root)
}
