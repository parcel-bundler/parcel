use std::path::Path;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use super::pattern_matcher;
use crate::PluginNode;

/// Represents fields in .atlaspackrc that map a pattern to a list of plugin names
///
/// # Examples
///
/// ```
/// use std::path::PathBuf;
/// use std::sync::Arc;
///
/// use indexmap::indexmap;
/// use atlaspack_config::map::PipelinesMap;
/// use atlaspack_config::PluginNode;
///
/// PipelinesMap::new(indexmap! {
///   String::from("*") => vec![PluginNode {
///     package_name: String::from("@atlaspack/compressor-raw"),
///     resolve_from: Arc::new(PathBuf::default()),
///   }]
/// });
/// ```
///
#[derive(Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct PipelinesMap(
  /// Maps patterns to a series of plugins, called pipelines
  IndexMap<String, Vec<PluginNode>>,
);

impl PipelinesMap {
  pub fn new(map: IndexMap<String, Vec<PluginNode>>) -> Self {
    Self(map)
  }

  /// Finds pipelines that match the given file path
  ///
  /// # Examples
  ///
  /// ```
  /// use std::path::Path;
  /// use std::path::PathBuf;
  /// use std::sync::Arc;
  ///
  /// use indexmap::indexmap;
  /// use atlaspack_config::map::PipelinesMap;
  /// use atlaspack_config::PluginNode;
  ///
  /// let pipelines_map = PipelinesMap::new(indexmap! {
  ///   String::from("*") => vec![PluginNode {
  ///     package_name: String::from("@atlaspack/compressor-raw"),
  ///     resolve_from: Arc::new(PathBuf::default()),
  ///   }]
  /// });
  ///
  /// pipelines_map.get(Path::new("component.tsx"));
  /// pipelines_map.get(Path::new("Cargo.toml"));
  /// ```
  pub fn get(&self, path: &Path) -> Vec<PluginNode> {
    let is_match = pattern_matcher(path);
    let mut matches: Vec<PluginNode> = Vec::new();

    for (pattern, pipelines) in self.0.iter() {
      if is_match(&pattern) {
        matches.extend(pipelines.iter().cloned());
      }
    }

    matches
  }
}

#[cfg(test)]
mod tests {
  use std::path::PathBuf;
  use std::sync::Arc;

  use super::*;

  fn pipelines(name: &str) -> Vec<PluginNode> {
    vec![PluginNode {
      package_name: format!("@atlaspack/plugin-{}", name),
      resolve_from: Arc::new(PathBuf::default()),
    }]
  }

  mod get {
    use indexmap::indexmap;

    use super::*;

    #[test]
    fn returns_empty_vec_for_empty_map() {
      let empty_map = PipelinesMap::default();

      assert_eq!(empty_map.get(Path::new("a.js")), Vec::new());
      assert_eq!(empty_map.get(Path::new("a.toml")), Vec::new());
    }

    #[test]
    fn returns_empty_vec_when_no_matching_path() {
      let map = PipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
      });

      assert_eq!(map.get(Path::new("a.css")), Vec::new());
      assert_eq!(map.get(Path::new("a.jsx")), Vec::new());
      assert_eq!(map.get(Path::new("a.tsx")), Vec::new());
    }

    #[test]
    fn returns_matching_plugins_for_path() {
      let map = PipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("*.ts") => pipelines("2"),
        String::from("*.toml") => pipelines("3"),
      });

      assert_eq!(map.get(Path::new("a.js")), pipelines("1"));
      assert_eq!(
        map.get(Path::new("a.ts")),
        [pipelines("1"), pipelines("2")].concat()
      );
      assert_eq!(map.get(Path::new("a.toml")), pipelines("3"));
    }
  }
}
