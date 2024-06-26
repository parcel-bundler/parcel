use std::path::Path;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use super::pattern_matcher;
use crate::PluginNode;

/// Represents fields in .parcelrc that map a pattern to a single plugin name
///
/// # Examples
///
/// ```
/// use std::path::PathBuf;
/// use std::sync::Arc;
///
/// use indexmap::indexmap;
/// use parcel_config::map::PipelineMap;
/// use parcel_config::PluginNode;
///
/// PipelineMap::new(indexmap! {
///   String::from("*.{js,mjs,cjs}") => PluginNode {
///     package_name: String::from("@parcel/packager-js"),
///     resolve_from: Arc::new(PathBuf::default()),
///   }
/// });
/// ```
///
#[derive(Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct PipelineMap(
  /// Maps patterns to a single pipeline plugin
  IndexMap<String, PluginNode>,
);

impl PipelineMap {
  pub fn new(map: IndexMap<String, PluginNode>) -> Self {
    Self(map)
  }

  /// Finds the plugin that matches the given file path
  ///
  /// # Examples
  ///
  /// ```
  /// use std::path::Path;
  /// use std::path::PathBuf;
  /// use std::sync::Arc;
  ///
  /// use indexmap::indexmap;
  /// use parcel_config::map::PipelineMap;
  /// use parcel_config::PluginNode;
  ///
  /// let pipeline_map = PipelineMap::new(indexmap! {
  ///   String::from("*.{js,mjs,cjs}") => PluginNode {
  ///     package_name: String::from("@parcel/packager-js"),
  ///     resolve_from: Arc::new(PathBuf::default()),
  ///   }
  /// });
  ///
  /// pipeline_map.get(Path::new("component.js"));
  /// pipeline_map.get(Path::new("Cargo.toml"));
  /// ```
  pub fn get(&self, path: &Path) -> Option<&PluginNode> {
    let is_match = pattern_matcher(path);

    for (pattern, plugin) in self.0.iter() {
      if is_match(pattern) {
        return Some(plugin);
      }
    }

    None
  }
}

#[cfg(test)]
mod tests {
  use std::path::PathBuf;
  use std::sync::Arc;

  use super::*;

  mod get {
    use indexmap::indexmap;

    use super::*;

    fn pipeline(name: &str) -> PluginNode {
      PluginNode {
        package_name: format!("@parcel/plugin-{}", name),
        resolve_from: Arc::new(PathBuf::default()),
      }
    }

    #[test]
    fn returns_none_for_empty_map() {
      let empty_map = PipelineMap::default();

      assert_eq!(empty_map.get(Path::new("a.js")), None);
      assert_eq!(empty_map.get(Path::new("a.toml")), None);
    }

    #[test]
    fn returns_none_when_no_matching_path() {
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipeline("1"),
      });

      assert_eq!(map.get(Path::new("a.css")), None);
      assert_eq!(map.get(Path::new("a.jsx")), None);
      assert_eq!(map.get(Path::new("a.tsx")), None);
    }

    #[test]
    fn returns_first_matching_pipeline() {
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipeline("1"),
        String::from("*.ts") => pipeline("2"),
        String::from("*.toml") => pipeline("3")
      });

      assert_eq!(map.get(Path::new("a.js")), Some(&pipeline("1")));
      assert_eq!(map.get(Path::new("a.ts")), Some(&pipeline("1")));
      assert_eq!(map.get(Path::new("a.toml")), Some(&pipeline("3")));
    }
  }
}
