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

#[cfg(test)]
mod tests {
  use crate::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  #[test]
  fn returns_none_when_there_are_no_ancestor_directories() {
    let fs = InMemoryFileSystem::default();

    let assert_no_ancestor_directory = |dirnames| {
      assert_eq!(
        find_ancestor_directory(&fs, dirnames, PathBuf::default(), PathBuf::default()),
        None
      );
    };

    assert_no_ancestor_directory(&[]);
    assert_no_ancestor_directory(&["src"]);
    assert_no_ancestor_directory(&["dist", "src"]);
  }

  #[test]
  fn returns_none_when_there_are_no_ancestor_files() {
    let fs = InMemoryFileSystem::default();

    let assert_no_ancestor_file = |filenames| {
      assert_eq!(
        find_ancestor_file(&fs, filenames, PathBuf::default(), PathBuf::default()),
        None
      );
    };

    assert_no_ancestor_file(&[]);
    assert_no_ancestor_file(&["package.json"]);
    assert_no_ancestor_file(&["package.json", "package-lock.json"]);
  }

  #[test]
  fn returns_none_when_there_are_no_matching_ancestor_directories() {
    let fs = InMemoryFileSystem::default();

    fs.create_directory(Path::new("srcs"));
    fs.create_directory(Path::new("packages/parcel/srcs"));
    fs.create_directory(Path::new("packages/parcel/descendent/src"));

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["src"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      None
    );
  }

  #[test]
  fn returns_none_when_there_are_are_no_matching_ancestor_files() {
    let fs = InMemoryFileSystem::default();

    fs.write_file(Path::new("packages.json"), String::from("{}"));

    fs.write_file(
      Path::new("packages/parcel/packages.json"),
      String::from("{}"),
    );

    fs.write_file(
      Path::new("packages/parcel/descendent/package.json"),
      String::from("{}"),
    );

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      None
    );
  }

  #[test]
  fn returns_none_when_ancestor_directory_is_a_file() {
    let fs = InMemoryFileSystem::default();

    fs.write_file(Path::new("packages/parcel/src.js"), String::default());

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["src"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      None
    );
  }

  #[test]
  fn returns_none_when_ancestor_file_is_a_directory() {
    let fs = InMemoryFileSystem::default();

    fs.create_directory(Path::new("packages/parcel/package.json"));

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      None
    );
  }

  #[test]
  fn returns_none_when_ancestor_directory_is_outside_root() {
    let fs = InMemoryFileSystem::default();

    fs.create_directory(Path::new("src"));

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["src"],
        PathBuf::from("packages/parcel"),
        PathBuf::from("packages")
      ),
      None
    );
  }

  #[test]
  fn returns_none_when_ancestor_file_is_outside_root() {
    let fs = InMemoryFileSystem::default();

    fs.write_file(Path::new("package.json"), String::from("{}"));

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::from("packages")
      ),
      None
    );
  }

  #[test]
  fn returns_first_closest_ancestor_directory_path() {
    let fs = InMemoryFileSystem::default();

    fs.create_directory(Path::new("dist"));
    fs.create_directory(Path::new("packages/dist"));
    fs.create_directory(Path::new("packages/parcel/dist"));

    fs.create_directory(Path::new("src"));
    fs.create_directory(Path::new("packages/src"));
    fs.create_directory(Path::new("packages/parcel/src"));

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["dist"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/dist"))
    );

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["src"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/src"))
    );

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["dist", "src"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/dist"))
    );

    assert_eq!(
      find_ancestor_directory(
        &fs,
        &["src", "dist"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/src"))
    );
  }

  #[test]
  fn returns_first_closest_ancestor_entry_path() {
    let fs = InMemoryFileSystem::default();

    fs.create_directory(Path::new("src"));
    fs.create_directory(Path::new("packages/src"));
    fs.create_directory(Path::new("packages/parcel/src"));

    fs.write_file(Path::new("package.json"), String::from("{}"));
    fs.write_file(Path::new("packages/package.json"), String::from("{}"));
    fs.write_file(
      Path::new("packages/parcel/package.json"),
      String::from("{}"),
    );

    assert_eq!(
      find_ancestor(
        &fs,
        &[Entry::Directory("src")],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/src"))
    );

    assert_eq!(
      find_ancestor(
        &fs,
        &[Entry::File("package.json")],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/package.json"))
    );

    assert_eq!(
      find_ancestor(
        &fs,
        &[Entry::Directory("src"), Entry::File("package.json")],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/src"))
    );

    assert_eq!(
      find_ancestor(
        &fs,
        &[Entry::File("package.json"), Entry::Directory("src")],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/package.json"))
    );
  }

  #[test]
  fn returns_first_closest_ancestor_file_path() {
    let fs = InMemoryFileSystem::default();

    fs.write_file(Path::new("package.json"), String::from("{}"));
    fs.write_file(Path::new("packages/package.json"), String::from("{}"));
    fs.write_file(
      Path::new("packages/parcel/package.json"),
      String::from("{}"),
    );

    fs.write_file(Path::new("package-lock.json"), String::from("{}"));
    fs.write_file(Path::new("packages/package-lock.json"), String::from("{}"));
    fs.write_file(
      Path::new("packages/parcel/package-lock.json"),
      String::from("{}"),
    );

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/package.json"))
    );

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package-lock.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/package-lock.json"))
    );

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package.json", "package-lock.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/package.json"))
    );

    assert_eq!(
      find_ancestor_file(
        &fs,
        &["package-lock.json", "package.json"],
        PathBuf::from("packages/parcel"),
        PathBuf::default()
      ),
      Some(PathBuf::from("packages/parcel/package-lock.json"))
    );
  }
}
