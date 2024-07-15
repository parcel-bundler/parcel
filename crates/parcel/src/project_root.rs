use std::path::{Component, Components, Path, PathBuf};

use parcel_core::types::Entry;
use parcel_filesystem::{
  search::{find_ancestor_directory, find_ancestor_file},
  FileSystemRef,
};

/// Makes the path absolute without accessing the filesystem
///
/// This implementation is a modified version of the built-in [absolute](https://doc.rust-lang.org/stable/std/path/fn.absolute.html) function
fn absolute(cwd: &Path, path: &Path) -> PathBuf {
  let mut components = path.strip_prefix(".").unwrap_or(path).components();
  let path_os = path.as_os_str().as_encoded_bytes();

  let mut normalized = if path.is_absolute() {
    if path_os.starts_with(b"//") && !path_os.starts_with(b"///") {
      components.next();
      PathBuf::from("//")
    } else {
      PathBuf::new()
    }
  } else {
    PathBuf::from(cwd)
  };

  normalized.extend(components);

  if path_os.ends_with(b"/") {
    normalized.push("");
  }

  normalized
}

struct CommonComponents<'a>(Vec<Components<'a>>);

/// An iterator that only returns the common components across all path components in series
impl<'a> Iterator for CommonComponents<'a> {
  type Item = Component<'a>;

  fn next(&mut self) -> Option<Self::Item> {
    // Get the next component for all of our components
    let components: Vec<Option<Component>> = self.0.iter_mut().map(Iterator::next).collect();

    // When the first component is available, check if all other components match as well
    if let Some(Some(component)) = components.first() {
      if components
        .iter()
        .all(|c| c.is_some_and(|c| &c == component))
      {
        return Some(component.to_owned());
      }
    }

    // Not all of the components are equal, so we are now done with the iterator
    return None;
  }
}

/// Finds the common path prefix shared between all input paths
fn common_path(paths: &[PathBuf]) -> Option<PathBuf> {
  let components = paths.iter().map(|path| path.components()).collect();
  let mut common_path: Option<PathBuf> = None;

  for component in CommonComponents(components) {
    common_path = common_path
      .map(|p| p.join(component))
      .or(Some(PathBuf::from(&component)));
  }

  common_path
}

pub fn infer_project_root(fs: FileSystemRef, entries: Option<Entry>) -> PathBuf {
  let cwd = fs.cwd().expect("Expected fs.cwd() to exist");

  // TODO Handle globs
  let entries = entries
    .map(|entry| match entry {
      Entry::Single(e) => vec![absolute(&cwd, Path::new(&e))],
      Entry::Multiple(entries) => entries
        .iter()
        .map(|e| absolute(&cwd, Path::new(&e)))
        .collect(),
    })
    .unwrap_or_default();

  let common_entry_path = common_path(&entries).unwrap_or_else(|| cwd.clone());

  let root = common_entry_path
    .components()
    .find(|c| c == &Component::RootDir)
    .map(|c| PathBuf::from(&c))
    .unwrap_or_else(|| cwd.clone());

  let project_root_file = find_ancestor_file(
    fs.as_ref(),
    &["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    common_entry_path.clone(),
    root.clone(),
  );

  let project_root_dir = project_root_file
    .or(find_ancestor_directory(
      fs.as_ref(),
      &[".git", ".hg"],
      common_entry_path.clone(),
      root,
    ))
    .map(|f| f.parent().map(|p| p.to_owned()).unwrap_or(f));

  project_root_dir.unwrap_or(cwd)
}

#[cfg(test)]
mod tests {
  use std::{path::MAIN_SEPARATOR_STR, sync::Arc};

  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use parcel_resolver::FileSystem;

  use super::*;

  mod returns_cwd_when_there_are_no_lockfiles_or_vcs {
    use super::*;

    #[test]
    fn or_entries() {
      let fs = Arc::new(InMemoryFileSystem::default());

      assert_eq!(infer_project_root(fs.clone(), None), fs.cwd().unwrap());
    }

    #[test]
    fn with_a_single_entry() {
      let fs = Arc::new(InMemoryFileSystem::default());

      assert_eq!(
        infer_project_root(fs.clone(), Some(Entry::Single(String::from("src/a.js")))),
        fs.cwd().unwrap()
      );
    }

    #[test]
    fn with_multiple_entries() {
      let fs = Arc::new(InMemoryFileSystem::default());

      assert_eq!(
        infer_project_root(
          fs.clone(),
          Some(Entry::Multiple(vec![
            String::from("src/a.js"),
            String::from("src/b.js")
          ]))
        ),
        fs.cwd().unwrap()
      );
    }
  }

  fn root() -> PathBuf {
    PathBuf::from(MAIN_SEPARATOR_STR)
  }

  fn cwd() -> PathBuf {
    root().join("parcel")
  }

  #[test]
  fn returns_the_root_lockfile_directory() {
    let assert_project_root = |lockfile: &str| {
      let entries = Some(Entry::Single(String::from("src/a.js")));
      let fs = Arc::new(InMemoryFileSystem::default());
      let root = root();

      fs.set_current_working_directory(cwd());
      fs.write_file(&root.join(lockfile), String::from("{}"));

      assert_eq!(infer_project_root(fs, entries), root);
    };

    assert_project_root("package-lock.json");
    assert_project_root("pnpm-lock.yaml");
    assert_project_root("yarn.lock");
  }

  mod returns_the_closest_lockfile_directory {
    use super::*;

    #[test]
    fn given_a_single_entry() {
      let assert_project_root = |lockfile| {
        let cwd = cwd();
        let entries = Some(Entry::Single(String::from("src/a.js")));
        let fs = Arc::new(InMemoryFileSystem::default());

        fs.set_current_working_directory(cwd.clone());
        fs.write_file(&root().join(lockfile), String::from("{}"));
        fs.write_file(&cwd.join(lockfile), String::from("{}"));

        assert_eq!(infer_project_root(fs, entries), cwd);
      };

      assert_project_root("package-lock.json");
      assert_project_root("pnpm-lock.yaml");
      assert_project_root("yarn.lock");
    }

    #[test]
    fn given_multiple_entries() {
      let assert_project_root = |lockfile| {
        let cwd = cwd();
        let entries = Some(Entry::Multiple(vec![
          String::from("packages/foo/a.js"),
          String::from("packages/bar/b.js"),
          String::from("packages/baz/c.js"),
        ]));

        let fs = Arc::new(InMemoryFileSystem::default());

        fs.set_current_working_directory(cwd.clone());
        fs.write_file(&root().join(lockfile), String::from("{}"));
        fs.write_file(
          &cwd.join("packages").join("foo").join(lockfile),
          String::from("{}"),
        );

        assert_eq!(infer_project_root(fs, entries), root());
      };

      assert_project_root("package-lock.json");
      assert_project_root("pnpm-lock.yaml");
      assert_project_root("yarn.lock");
    }
  }

  #[test]
  fn returns_the_vcs_parent_directory() {
    let assert_project_root = |vcs| {
      let entries = Some(Entry::Single(String::from("src/a.js")));
      let fs = Arc::new(InMemoryFileSystem::default());
      let root = root();

      fs.set_current_working_directory(cwd());
      fs.create_directory(&root.join(vcs));

      assert_eq!(infer_project_root(fs, entries), root);
    };

    assert_project_root(".git");
    assert_project_root(".hg");
  }
}
