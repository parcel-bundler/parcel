//! Absolute fixture paths and URLs for tests that run on every host platform.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub fn path(value: &str) -> PathBuf {
  let value = if cfg!(windows) && value.starts_with('/') {
    format!("C:{value}")
  } else {
    value.to_owned()
  };
  Path::new(&value).components().collect()
}

pub fn url(value: &str) -> String {
  if cfg!(windows)
    && value
      .strip_prefix("file:///")
      .is_some_and(|path| path.as_bytes().get(1) != Some(&b':'))
  {
    value.replacen("file:///", "file:///C:/", 1)
  } else {
    value.to_owned()
  }
}

/// Give JS plugins the same native fixture paths as their Rust callers.
pub fn js(code: &str) -> String {
  let helpers = if cfg!(windows) {
    r#"const testPath = p => 'C:' + p.replaceAll('/', '\\');
const testUrl = u => u.replace('file:///', 'file:///C:/');"#
  } else {
    "const testPath = p => p; const testUrl = u => u;"
  };
  format!("{helpers}\n{code}")
}
