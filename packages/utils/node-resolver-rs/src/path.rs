use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

pub fn normalize_path(path: &Path) -> PathBuf {
  // Normalize path components to resolve ".." and "." segments.
  // https://github.com/rust-lang/cargo/blob/fede83ccf973457de319ba6fa0e36ead454d2e20/src/cargo/util/paths.rs#L61
  let mut components = path.components().peekable();
  let mut ret = if let Some(c @ Component::Prefix(..)) = components.peek().cloned() {
    components.next();
    PathBuf::from(c.as_os_str())
  } else {
    PathBuf::new()
  };

  for component in components {
    match component {
      Component::Prefix(..) => unreachable!(),
      Component::RootDir => {
        ret.push(component.as_os_str());
      }
      Component::CurDir => {}
      Component::ParentDir => {
        ret.pop();
      }
      Component::Normal(c) => {
        ret.push(c);
      }
    }
  }

  ret
}

pub fn resolve_path<A: AsRef<Path>, B: AsRef<Path>>(base: A, subpath: B) -> PathBuf {
  let subpath = subpath.as_ref();
  let mut components = subpath.components().peekable();
  if subpath.is_absolute() || matches!(components.peek(), Some(Component::Prefix(..))) {
    return subpath.to_path_buf();
  }

  let mut ret = base.as_ref().to_path_buf();
  ret.pop();
  for component in subpath.components() {
    match component {
      Component::Prefix(..) | Component::RootDir => unreachable!(),
      Component::CurDir => {}
      Component::ParentDir => {
        ret.pop();
      }
      Component::Normal(c) => {
        ret.push(c);
      }
    }
  }

  println!("ret {}", ret.display());
  ret
}
