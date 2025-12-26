use std::{
  path::{Path, PathBuf},
  sync::Arc,
};

use serde::{Deserialize, Serialize};
use url::Url;

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
  pub line: u32,
  pub column: u32,
}

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
  pub fn parse(url: &str) -> Result<SourceUrl, url::ParseError> {
    Ok(SourceUrl {
      url: Arc::new(Url::parse(url)?),
    })
  }

  pub fn from_path(path: &Path) -> Result<SourceUrl, ()> {
    Ok(SourceUrl {
      url: Arc::new(Url::from_file_path(path)?),
    })
  }

  pub fn to_file_path(&self) -> Result<PathBuf, ()> {
    self.url.to_file_path()
  }

  pub fn as_str(&self) -> &str {
    self.url.as_str()
  }

  pub fn extension(&self) -> &str {
    let path = self.url.path();
    let (_, ext) = path.rsplit_once('.').unwrap_or((path, ""));
    ext
  }

  pub fn with_extension(&self, ext: &str) -> Result<SourceUrl, ()> {
    let path = self.url.path();
    let (base, _) = path.rsplit_once('.').unwrap_or((path, ""));
    let path = format!("{}.{}", base, ext);
    let mut url = (*self.url).clone();
    url.set_path(&path);
    Ok(SourceUrl { url: Arc::new(url) })
  }

  pub fn query(&self) -> Option<&str> {
    self.url.query()
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
