use std::hash::Hash;

use serde::Deserialize;
use serde::Serialize;

/// Represents a file type by its extension
///
/// Defaults to `FileType::Js` for convenience.
#[derive(Default, Debug, Clone, PartialEq, Hash)]
pub enum FileType {
  Css,
  Html,
  #[default]
  Js,
  Json,
  Jsx,
  Ts,
  Tsx,
  Other(String),
}

impl Serialize for FileType {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    self.extension().serialize(serializer)
  }
}

impl<'de> Deserialize<'de> for FileType {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let ext: String = Deserialize::deserialize(deserializer)?;
    Ok(Self::from_extension(&ext))
  }
}

impl FileType {
  pub fn extension(&self) -> &str {
    match self {
      FileType::Js => "js",
      FileType::Json => "json",
      FileType::Jsx => "jsx",
      FileType::Ts => "ts",
      FileType::Tsx => "tsx",
      FileType::Css => "css",
      FileType::Html => "html",
      FileType::Other(s) => s.as_str(),
    }
  }

  pub fn from_extension(ext: &str) -> Self {
    match ext {
      "js" => FileType::Js,
      "mjs" => FileType::Js,
      "cjs" => FileType::Js,
      "jsx" => FileType::Jsx,
      "ts" => FileType::Ts,
      "tsx" => FileType::Tsx,
      "json" => FileType::Json,
      "css" => FileType::Css,
      "html" => FileType::Html,
      ext => FileType::Other(ext.to_string()),
    }
  }
}
