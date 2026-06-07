use std::{
  borrow::Cow,
  path::{Path, PathBuf},
  sync::Arc,
};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::Diagnostic;

#[derive(PartialEq, Eq, Debug, Default, Clone, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
  /// URL to the location of the file.
  pub url: SourceUrl,
  /// Line and column offset of the start of the location within the file.
  pub start: Location,
  /// Line and column offset of the end of the location within the file.
  pub end: Location,
}

#[derive(PartialEq, Eq, Debug, Default, Clone, Hash, Serialize, Deserialize)]
pub struct Location {
  #[serde(default)]
  pub line: u32,
  #[serde(default)]
  pub column: u32,
}

/// A URL representing a file path. For files within the project root, the `project://` scheme
/// is used with the path relative to the project root, making URLs portable between machines.
/// Files outside the project root use the standard `file://` scheme with an absolute path.
#[derive(PartialEq, Eq, Clone, Hash)]
pub struct SourceUrl {
  url: Arc<Url>,
}

impl serde::Serialize for SourceUrl {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.url.as_str().serialize(serializer)
  }
}

impl<'de> serde::Deserialize<'de> for SourceUrl {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let url: &str = Deserialize::deserialize(deserializer)?;
    let url = Url::parse(url).map_err(|e| serde::de::Error::custom(e.to_string()))?;
    Ok(SourceUrl { url: Arc::new(url) })
  }
}

impl Default for SourceUrl {
  fn default() -> Self {
    SourceUrl {
      url: Arc::new(Url::parse("file:///default").unwrap()),
    }
  }
}

impl SourceUrl {
  pub fn parse(url: &str) -> Result<SourceUrl, Diagnostic> {
    Ok(SourceUrl {
      url: Arc::new(Url::parse(url).map_err(|err| {
        Diagnostic::from_message(format!("Could not parse url {:?} {}", url, err.to_string()))
      })?),
    })
  }

  /// Creates a `SourceUrl` from an absolute file path as a `file://` URL.
  pub fn from_absolute_path(path: &Path) -> Result<SourceUrl, Diagnostic> {
    Url::from_file_path(path)
      .map_err(|_| {
        Diagnostic::from_message(format!(
          "Could not convert non-absolute path to URL: {:?}",
          path
        ))
      })
      .map(|url| SourceUrl { url: Arc::new(url) })
  }

  /// Creates a `SourceUrl` from an absolute directory path as a `file://` URL.
  pub fn from_absolute_directory_path(path: &Path) -> Result<SourceUrl, Diagnostic> {
    Url::from_directory_path(path)
      .map_err(|_| {
        Diagnostic::from_message(format!(
          "Could not convert non-absolute path to URL: {:?}",
          path
        ))
      })
      .map(|url| SourceUrl { url: Arc::new(url) })
  }

  /// Creates a `SourceUrl` from a file path. If the path is within `project_root`, the URL
  /// uses the `project://` scheme (relative to the project root). Otherwise, a `file://` URL
  /// with the absolute path is returned. `project_root` must be a `file://` URL.
  pub fn from_path(path: &Path, project_root: &SourceUrl) -> Result<SourceUrl, Diagnostic> {
    let file_url = Url::from_file_path(path).map_err(|_| {
      Diagnostic::from_message(format!(
        "Could not convert non-absolute path to URL: {:?}",
        path
      ))
    })?;

    if project_root.url.scheme() == "file" {
      let root_url_path = project_root.url.path(); // e.g. "/home/user/project/"
      let file_url_path = file_url.path(); // e.g. "/home/user/project/src/foo.js"

      if root_url_path.ends_with('/') {
        if file_url_path.starts_with(root_url_path) {
          // Path is within project root
          let rel = &file_url_path[root_url_path.len()..];
          let url = Url::parse(&format!("project:///{}", rel)).map_err(|e| {
            Diagnostic::from_message(format!("Could not create project URL: {}", e))
          })?;
          return Ok(SourceUrl { url: Arc::new(url) });
        } else if file_url_path == root_url_path.trim_end_matches('/') {
          // path equals the project root directory itself
          return Ok(SourceUrl {
            url: Arc::new(Url::parse("project:///").unwrap()),
          });
        }
      }
    }

    Ok(SourceUrl {
      url: Arc::new(file_url),
    })
  }

  /// Creates a `SourceUrl` from a directory path (URL will have a trailing slash). If the
  /// directory is within `project_root`, the URL uses the `project://` scheme. Otherwise,
  /// a `file://` URL is returned. `project_root` must be a `file://` URL.
  pub fn from_directory_path(
    path: &Path,
    project_root: &SourceUrl,
  ) -> Result<SourceUrl, Diagnostic> {
    let dir_url = Url::from_directory_path(path).map_err(|_| {
      Diagnostic::from_message(format!(
        "Could not convert non-absolute path to URL: {:?}",
        path
      ))
    })?;

    if project_root.url.scheme() == "file" {
      let root_url_path = project_root.url.path(); // e.g. "/home/user/project/"
      let dir_url_path = dir_url.path(); // e.g. "/home/user/project/src/"

      if root_url_path.ends_with('/') && dir_url_path.starts_with(root_url_path) {
        let rel = &dir_url_path[root_url_path.len()..];
        let url = Url::parse(&format!("project:///{}", rel))
          .map_err(|e| Diagnostic::from_message(format!("Could not create project URL: {}", e)))?;
        return Ok(SourceUrl { url: Arc::new(url) });
      }
    }

    Ok(SourceUrl {
      url: Arc::new(dir_url),
    })
  }

  /// Creates a `SourceUrl` from a file path and optional query string. If the path is within
  /// `project_root`, the URL uses the `project://` scheme. `project_root` must be a `file://` URL.
  pub fn from_path_and_query(
    path: &Path,
    query: Option<&str>,
    project_root: &SourceUrl,
  ) -> Result<SourceUrl, Diagnostic> {
    let base = SourceUrl::from_path(path, project_root)?;
    if query.is_none() {
      return Ok(base);
    }
    let mut url = (*base.url).clone();
    url.set_query(query);
    Ok(SourceUrl { url: Arc::new(url) })
  }

  /// Converts the URL to a file system path. For `project://` URLs, the path is resolved
  /// relative to `project_root`, which must be a `file://` URL. For `file://` URLs, the
  /// path is returned as-is.
  pub fn to_file_path(&self, project_root: &SourceUrl) -> Result<PathBuf, Diagnostic> {
    if self.url.scheme() == "project" {
      // Resolve relative to project root (which must be a file:// URL with trailing slash).
      let path_str = self.url.path().trim_start_matches('/');
      let resolved = project_root.url.join(path_str).map_err(|_| {
        Diagnostic::from_message(format!(
          "Could not resolve project URL {:?} with root {:?}",
          self.url.as_str(),
          project_root.url.as_str()
        ))
      })?;
      resolved.to_file_path().map_err(|_| {
        Diagnostic::from_message(format!(
          "Could not convert project URL to file path: {:?}",
          self.url.as_str()
        ))
      })
    } else {
      self.url.to_file_path().map_err(|_| {
        Diagnostic::from_message(format!(
          "Could not convert SourceUrl to file path: {:?}",
          self.url.as_str()
        ))
      })
    }
  }

  pub fn to_file_url(&self, project_root: &SourceUrl) -> Result<SourceUrl, Diagnostic> {
    if self.url.scheme() == "project" {
      let path_str = self.url.path().trim_start_matches('/');
      project_root
        .url
        .join(path_str)
        .map_err(|_| {
          Diagnostic::from_message(format!(
            "Could not resolve project URL {:?} with root {:?}",
            self.url.as_str(),
            project_root.url.as_str()
          ))
        })
        .map(|url| SourceUrl { url: Arc::new(url) })
    } else {
      Ok(self.clone())
    }
  }

  pub fn as_str(&self) -> &str {
    self.url.as_str()
  }

  pub fn path(&self) -> &str {
    self.url.path()
  }

  pub fn extension(&self) -> &str {
    let path = self.url.path();
    let (_, ext) = path.rsplit_once('.').unwrap_or((path, ""));
    ext
  }

  pub fn with_extension(&self, ext: &str) -> SourceUrl {
    let path = self.url.path();
    let (base, _) = path.rsplit_once('.').unwrap_or((path, ""));
    let path = format!("{}.{}", base, ext);
    let mut url = (*self.url).clone();
    url.set_path(&path);
    SourceUrl { url: Arc::new(url) }
  }

  pub fn query(&self) -> Option<&str> {
    self.url.query()
  }

  pub fn query_pairs(&self) -> impl Iterator<Item = (Cow<'_, str>, Cow<'_, str>)> {
    self.url.query_pairs()
  }

  pub fn url(&self) -> &Url {
    &*self.url
  }

  /// Returns a relative path string from `from` to `self`. For `project://` URLs, returns
  /// the path relative to the project root (without leading slash). For `file://` URLs,
  /// uses URL's make_relative to compute the relative path.
  pub fn relative(&self, from: &SourceUrl) -> Option<String> {
    // Try make_relative first — works when both URLs have the same scheme and host.
    // This correctly handles project:// -> project:// (e.g. relative path between two
    // project-relative URLs) and file:// -> file://.
    if let Some(rel) = from.url.make_relative(&self.url) {
      return Some(rel);
    }
    // When schemes differ (e.g. from=file://, self=project://), fall back to returning
    // the project-relative path without the leading '/' so it is stable across machines.
    if self.url.scheme() == "project" {
      Some(self.url.path()[1..].to_owned())
    } else {
      None
    }
  }

  pub fn join(&self, other: &str) -> SourceUrl {
    SourceUrl {
      url: Arc::new(self.url.join(other).unwrap()),
    }
  }

  pub fn parent(&self) -> Option<SourceUrl> {
    self
      .url
      .join("../")
      .ok()
      .map(|url| SourceUrl { url: Arc::new(url) })
  }
}

impl std::fmt::Display for SourceUrl {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.url.fmt(f)
  }
}

impl std::fmt::Debug for SourceUrl {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.url.as_str().fmt(f)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::hash::{DefaultHasher, Hash, Hasher};

  fn make_root(path: &str) -> SourceUrl {
    SourceUrl::from_absolute_directory_path(Path::new(path)).unwrap()
  }

  #[test]
  fn test_from_path_within_project() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/home/user/project/src/foo.js"), &root).unwrap();
    assert_eq!(url.as_str(), "project:///src/foo.js");
  }

  #[test]
  fn test_from_path_outside_project() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/usr/lib/node_modules/foo.js"), &root).unwrap();
    assert_eq!(url.as_str(), "file:///usr/lib/node_modules/foo.js");
  }

  #[test]
  fn test_from_path_is_project_root() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/home/user/project"), &root).unwrap();
    assert_eq!(url.as_str(), "project:///");
  }

  #[test]
  fn test_from_directory_path_within_project() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_directory_path(Path::new("/home/user/project/src"), &root).unwrap();
    assert_eq!(url.as_str(), "project:///src/");
  }

  #[test]
  fn test_from_directory_path_is_project_root() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_directory_path(Path::new("/home/user/project"), &root).unwrap();
    assert_eq!(url.as_str(), "project:///");
  }

  #[test]
  fn test_from_directory_path_outside_project() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_directory_path(Path::new("/usr/lib"), &root).unwrap();
    assert_eq!(url.as_str(), "file:///usr/lib/");
  }

  #[test]
  fn test_to_file_path_project_url() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::parse("project:///src/foo.js").unwrap();
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, Path::new("/home/user/project/src/foo.js"));
  }

  #[test]
  fn test_to_file_path_file_url() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::parse("file:///usr/lib/foo.js").unwrap();
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, Path::new("/usr/lib/foo.js"));
  }

  #[test]
  fn test_to_file_path_project_root_url() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::parse("project:///").unwrap();
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, Path::new("/home/user/project"));
  }

  #[test]
  fn test_roundtrip_within_project() {
    let root = make_root("/home/user/project");
    let original = Path::new("/home/user/project/src/foo.js");
    let url = SourceUrl::from_path(original, &root).unwrap();
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, original);
  }

  #[test]
  fn test_roundtrip_outside_project() {
    let root = make_root("/home/user/project");
    let original = Path::new("/usr/lib/node_modules/foo.js");
    let url = SourceUrl::from_path(original, &root).unwrap();
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, original);
  }

  #[test]
  fn test_relative_of_project_url() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/home/user/project/src/foo.js"), &root).unwrap();
    let rel = url.relative(&root);
    assert_eq!(rel, Some("src/foo.js".to_owned()));
  }

  #[test]
  fn test_relative_of_project_root_url() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::parse("project:///").unwrap();
    let rel = url.relative(&root);
    assert_eq!(rel, Some("".to_owned()));
  }

  #[test]
  fn test_hash_portability() {
    // Same relative paths in different absolute project roots should produce the same hash.
    let root1 = make_root("/home/user1/project");
    let root2 = make_root("/home/user2/different_project");

    let url1 = SourceUrl::from_path(Path::new("/home/user1/project/src/foo.js"), &root1).unwrap();
    let url2 = SourceUrl::from_path(
      Path::new("/home/user2/different_project/src/foo.js"),
      &root2,
    )
    .unwrap();

    assert_eq!(url1.as_str(), "project:///src/foo.js");
    assert_eq!(url2.as_str(), "project:///src/foo.js");

    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    url1.hash(&mut h1);
    url2.hash(&mut h2);
    assert_eq!(h1.finish(), h2.finish());
  }

  #[test]
  fn test_from_path_and_query() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path_and_query(
      Path::new("/home/user/project/src/foo.js"),
      Some("transform=true"),
      &root,
    )
    .unwrap();
    assert_eq!(url.as_str(), "project:///src/foo.js?transform=true");
    assert_eq!(url.query(), Some("transform=true"));
  }

  #[test]
  fn test_from_path_and_query_to_file_path() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path_and_query(
      Path::new("/home/user/project/src/foo.js"),
      Some("transform=true"),
      &root,
    )
    .unwrap();
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, Path::new("/home/user/project/src/foo.js"));
  }

  #[test]
  fn test_with_percent_encoded_path() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/home/user/project/src/foo bar.js"), &root).unwrap();
    // URL should be percent-encoded
    assert!(url.as_str().contains("foo%20bar") || url.as_str().contains("foo bar"));
    let path = url.to_file_path(&root).unwrap();
    assert_eq!(path, Path::new("/home/user/project/src/foo bar.js"));
  }

  #[test]
  fn test_extension() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/home/user/project/src/foo.js"), &root).unwrap();
    assert_eq!(url.extension(), "js");
  }

  #[test]
  fn test_with_extension() {
    let root = make_root("/home/user/project");
    let url = SourceUrl::from_path(Path::new("/home/user/project/src/foo.js"), &root).unwrap();
    let css_url = url.with_extension("css");
    assert_eq!(css_url.as_str(), "project:///src/foo.css");
  }
}
