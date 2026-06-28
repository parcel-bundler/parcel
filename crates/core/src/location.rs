use std::{
  borrow::Cow,
  hash::{Hash, Hasher},
  path::{Path, PathBuf},
  sync::{Arc, OnceLock},
};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::{Diagnostic, PathId};

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

impl SourceLocation {
  pub fn stable_hash<H: Hasher>(&self, project_root: &PathId, state: &mut H) {
    self.url.stable_hash(project_root, state);
    self.start.hash(state);
    self.end.hash(state);
  }
}

#[derive(PartialEq, Eq, Debug, Default, Clone, Hash, Serialize, Deserialize)]
pub struct Location {
  #[serde(default)]
  pub line: u32,
  #[serde(default)]
  pub column: u32,
}

/// A source location backed by either an interned file path or a fallback URL for non-file schemes.
/// File-backed source URLs keep the original path internally. Portable project-relative URLs are
/// derived on demand for stable hashes and other output-facing identities.
#[derive(PartialEq, Eq, Clone, Hash)]
enum SourceUrlKind {
  Path {
    path: PathId,
    query: Option<Arc<str>>,
    is_directory: bool,
  },
  Url(Arc<Url>),
}

#[derive(Eq)]
pub struct SourceUrl {
  kind: SourceUrlKind,
  serialized: OnceLock<String>,
  path: OnceLock<String>,
}

impl Clone for SourceUrl {
  fn clone(&self) -> Self {
    SourceUrl {
      kind: self.kind.clone(),
      serialized: OnceLock::new(),
      path: OnceLock::new(),
    }
  }
}

impl PartialEq for SourceUrl {
  fn eq(&self, other: &Self) -> bool {
    self.kind == other.kind
  }
}

impl Hash for SourceUrl {
  fn hash<H: Hasher>(&self, state: &mut H) {
    self.kind.hash(state);
  }
}

impl serde::Serialize for SourceUrl {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.as_str().serialize(serializer)
  }
}

impl<'de> serde::Deserialize<'de> for SourceUrl {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let url: &str = Deserialize::deserialize(deserializer)?;
    SourceUrl::parse(url).map_err(|e| serde::de::Error::custom(e.message))
  }
}

impl Default for SourceUrl {
  fn default() -> Self {
    SourceUrl::from_path(&PathId::new(Path::new("/default"))).unwrap()
  }
}

impl SourceUrl {
  fn new(kind: SourceUrlKind) -> SourceUrl {
    SourceUrl {
      kind,
      serialized: OnceLock::new(),
      path: OnceLock::new(),
    }
  }

  pub fn parse(url: &str) -> Result<SourceUrl, Diagnostic> {
    let parsed = Url::parse(url).map_err(|err| {
      Diagnostic::from_message(format!("Could not parse url {:?} {}", url, err.to_string()))
    })?;
    let is_directory = parsed.path().ends_with('/');
    let query = parsed.query().map(Arc::from);
    match parsed.scheme() {
      "project" => Err(Diagnostic::from_message(
        "project:// URLs are derived for stable identities and cannot be stored as SourceUrl"
          .to_owned(),
      )),
      "file" => parsed
        .to_file_path()
        .map(|path| {
          SourceUrl::new(SourceUrlKind::Path {
            path: PathId::new(&path),
            query,
            is_directory,
          })
        })
        .map_err(|_| {
          Diagnostic::from_message(format!(
            "Could not convert file URL to path: {:?}",
            parsed.as_str()
          ))
        }),
      _ => Ok(SourceUrl::new(SourceUrlKind::Url(Arc::new(parsed)))),
    }
  }

  /// Creates a file-backed `SourceUrl` from a file path.
  pub fn from_path(path: &PathId) -> Result<SourceUrl, Diagnostic> {
    Ok(SourceUrl::new(SourceUrlKind::Path {
      path: *path,
      query: None,
      is_directory: false,
    }))
  }

  /// Creates a `SourceUrl` from a directory path (URL will have a trailing slash).
  pub fn from_directory_path(path: &PathId) -> Result<SourceUrl, Diagnostic> {
    Ok(SourceUrl::new(SourceUrlKind::Path {
      path: *path,
      query: None,
      is_directory: true,
    }))
  }

  fn project_relative_path(&self, project_root: &PathId) -> Option<PathBuf> {
    match &self.kind {
      SourceUrlKind::Path { path, .. } => {
        let path = path.to_path_buf();
        let root = project_root.to_path_buf();
        path.strip_prefix(root).ok().map(|p| p.to_path_buf())
      }
      SourceUrlKind::Url(_) => None,
    }
  }

  pub fn stable_id(&self, project_root: &PathId) -> String {
    if let Some(rel) = self.project_relative_path(project_root) {
      let mut path = path_to_url_path(&rel);
      if !path.starts_with('/') {
        path.insert(0, '/');
      }
      if path == "/" && !self.is_directory() {
        path.clear();
        path.push('/');
      }
      let mut res = format!("project://{}", path);
      if self.is_directory() && !res.ends_with('/') {
        res.push('/');
      }
      if let Some(query) = self.query() {
        res.push('?');
        res.push_str(query);
      }
      res
    } else {
      self.as_str().to_owned()
    }
  }

  pub fn stable_hash<H: Hasher>(&self, project_root: &PathId, state: &mut H) {
    Url::parse(&self.stable_id(project_root))
      .expect("SourceUrl stable id should be a valid URL")
      .hash(state);
  }

  /// Creates a file-backed `SourceUrl` from an absolute file path and optional query string.
  pub fn from_path_and_query(path: &PathId, query: Option<&str>) -> Result<SourceUrl, Diagnostic> {
    let base = SourceUrl::from_path(path)?;
    if query.is_none() {
      return Ok(base);
    }
    Ok(base.with_query(query))
  }

  fn with_query(&self, query: Option<&str>) -> SourceUrl {
    let query = query.map(Arc::from);
    match &self.kind {
      SourceUrlKind::Path {
        path, is_directory, ..
      } => SourceUrl::new(SourceUrlKind::Path {
        path: *path,
        query,
        is_directory: *is_directory,
      }),
      SourceUrlKind::Url(url) => {
        let mut url = (**url).clone();
        url.set_query(query.as_deref());
        SourceUrl::new(SourceUrlKind::Url(Arc::new(url)))
      }
    }
  }

  /// Converts the source URL to a file system path. Fallback non-file URLs cannot be converted.
  pub fn to_file_path(&self) -> Result<PathId, Diagnostic> {
    match &self.kind {
      SourceUrlKind::Path { path, .. } => Ok(*path),
      SourceUrlKind::Url(url) => url.to_file_path().map(|p| PathId::new(&p)).map_err(|_| {
        Diagnostic::from_message(format!(
          "Could not convert SourceUrl to file path: {:?}",
          url.as_str()
        ))
      }),
    }
  }

  pub fn to_file_url(&self) -> Result<SourceUrl, Diagnostic> {
    Ok(self.clone())
  }

  pub fn as_str(&self) -> &str {
    self.serialized.get_or_init(|| match &self.kind {
      SourceUrlKind::Path {
        path,
        query,
        is_directory,
      } => {
        let mut url = Url::from_file_path(path.to_path_buf()).unwrap();
        if *is_directory && !url.path().ends_with('/') {
          let mut path = url.path().to_owned();
          path.push('/');
          url.set_path(&path);
        }
        url.set_query(query.as_deref());
        url.to_string()
      }
      SourceUrlKind::Url(url) => url.as_str().to_owned(),
    })
  }

  pub fn path(&self) -> &str {
    self.path.get_or_init(|| match &self.kind {
      SourceUrlKind::Path { path, .. } => path.to_path_buf().to_string_lossy().into_owned(),
      SourceUrlKind::Url(url) => url.path().to_owned(),
    })
  }

  pub fn extension(&self) -> &str {
    match &self.kind {
      SourceUrlKind::Path { path, .. } => path.extension().unwrap_or(""),
      SourceUrlKind::Url(url) => {
        let path = url.path();
        let (_, ext) = path.rsplit_once('.').unwrap_or((path, ""));
        ext
      }
    }
  }

  pub fn query(&self) -> Option<&str> {
    match &self.kind {
      SourceUrlKind::Path { query, .. } => query.as_deref(),
      SourceUrlKind::Url(url) => url.query(),
    }
  }

  pub fn query_pairs(&self) -> Box<dyn Iterator<Item = (Cow<'_, str>, Cow<'_, str>)> + '_> {
    match &self.kind {
      SourceUrlKind::Path { query, .. } => Box::new(url::form_urlencoded::parse(
        query.as_deref().unwrap_or("").as_bytes(),
      )),
      SourceUrlKind::Url(url) => Box::new(url.query_pairs()),
    }
  }

  fn is_directory(&self) -> bool {
    match &self.kind {
      SourceUrlKind::Path { is_directory, .. } => *is_directory,
      SourceUrlKind::Url(url) => url.path().ends_with('/'),
    }
  }

  /// Returns a relative URL string from `from` to `self` when both can be represented as URLs.
  pub fn relative(&self, from: &SourceUrl) -> Option<String> {
    let from_url = Url::parse(from.as_str()).ok()?;
    let self_url = Url::parse(self.as_str()).ok()?;
    if let Some(rel) = from_url.make_relative(&self_url) {
      return Some(rel);
    }
    None
  }

  pub fn join(&self, other: &str) -> SourceUrl {
    let url = Url::parse(self.as_str()).unwrap().join(other).unwrap();
    SourceUrl::parse(url.as_str()).unwrap()
  }
}

impl std::fmt::Display for SourceUrl {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_str().fmt(f)
  }
}

impl std::fmt::Debug for SourceUrl {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.as_str().fmt(f)
  }
}

fn path_to_url_path(path: &Path) -> String {
  path
    .to_string_lossy()
    .replace(std::path::MAIN_SEPARATOR, "/")
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::hash::{DefaultHasher, Hasher};

  fn make_root(path: &str) -> PathId {
    PathId::new(Path::new(path))
  }

  fn make_path(path: &str) -> PathId {
    PathId::new(Path::new(path))
  }

  #[test]
  fn test_from_path_within_project() {
    let url = SourceUrl::from_path(&make_path("/home/user/project/src/foo.js")).unwrap();
    assert_eq!(url.as_str(), "file:///home/user/project/src/foo.js");
  }

  #[test]
  fn test_from_path_outside_project() {
    let url = SourceUrl::from_path(&make_path("/usr/lib/node_modules/foo.js")).unwrap();
    assert_eq!(url.as_str(), "file:///usr/lib/node_modules/foo.js");
  }

  #[test]
  fn test_from_path_is_project_root() {
    let url = SourceUrl::from_path(&make_path("/home/user/project")).unwrap();
    assert_eq!(url.as_str(), "file:///home/user/project");
  }

  #[test]
  fn test_from_directory_path_within_project() {
    let url = SourceUrl::from_directory_path(&make_path("/home/user/project/src")).unwrap();
    assert_eq!(url.as_str(), "file:///home/user/project/src/");
  }

  #[test]
  fn test_from_directory_path_is_project_root() {
    let url = SourceUrl::from_directory_path(&make_path("/home/user/project")).unwrap();
    assert_eq!(url.as_str(), "file:///home/user/project/");
  }

  #[test]
  fn test_from_directory_path_outside_project() {
    let url = SourceUrl::from_directory_path(&make_path("/usr/lib")).unwrap();
    assert_eq!(url.as_str(), "file:///usr/lib/");
  }

  #[test]
  fn test_to_file_path_file_url() {
    let url = SourceUrl::parse("file:///usr/lib/foo.js").unwrap();
    let path = url.to_file_path().unwrap();
    assert_eq!(path.to_path_buf(), Path::new("/usr/lib/foo.js"));
  }

  #[test]
  fn test_roundtrip_within_project() {
    let original = Path::new("/home/user/project/src/foo.js");
    let url = SourceUrl::from_path(&PathId::new(original)).unwrap();
    let path = url.to_file_path().unwrap();
    assert_eq!(path.to_path_buf(), original);
  }

  #[test]
  fn test_roundtrip_outside_project() {
    let original = Path::new("/usr/lib/node_modules/foo.js");
    let url = SourceUrl::from_path(&PathId::new(original)).unwrap();
    let path = url.to_file_path().unwrap();
    assert_eq!(path.to_path_buf(), original);
  }

  #[test]
  fn test_hash_portability() {
    // Same relative paths in different absolute project roots should produce the same hash.
    let root1 = make_root("/home/user1/project");
    let root2 = make_root("/home/user2/different_project");

    let url1 = SourceUrl::from_path(&make_path("/home/user1/project/src/foo.js")).unwrap();
    let url2 =
      SourceUrl::from_path(&make_path("/home/user2/different_project/src/foo.js")).unwrap();

    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    url1.stable_hash(&root1, &mut h1);
    url2.stable_hash(&root2, &mut h2);
    assert_eq!(h1.finish(), h2.finish());
  }

  #[test]
  fn test_from_path_and_query() {
    let url = SourceUrl::from_path_and_query(
      &make_path("/home/user/project/src/foo.js"),
      Some("transform=true"),
    )
    .unwrap();
    assert_eq!(
      url.as_str(),
      "file:///home/user/project/src/foo.js?transform=true"
    );
    assert_eq!(url.query(), Some("transform=true"));
  }

  #[test]
  fn test_from_path_and_query_to_file_path() {
    let url = SourceUrl::from_path_and_query(
      &make_path("/home/user/project/src/foo.js"),
      Some("transform=true"),
    )
    .unwrap();
    let path = url.to_file_path().unwrap();
    assert_eq!(
      path.to_path_buf(),
      Path::new("/home/user/project/src/foo.js")
    );
  }

  #[test]
  fn test_with_percent_encoded_path() {
    let url = SourceUrl::from_path(&make_path("/home/user/project/src/foo bar.js")).unwrap();
    // URL should be percent-encoded
    assert!(url.as_str().contains("foo%20bar") || url.as_str().contains("foo bar"));
    let path = url.to_file_path().unwrap();
    assert_eq!(
      path.to_path_buf(),
      Path::new("/home/user/project/src/foo bar.js")
    );
  }

  #[test]
  fn test_extension() {
    let url = SourceUrl::from_path(&make_path("/home/user/project/src/foo.js")).unwrap();
    assert_eq!(url.extension(), "js");
  }
}
