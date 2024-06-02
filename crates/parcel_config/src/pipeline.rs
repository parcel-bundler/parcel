use std::path::Path;

use glob_match::glob_match;
use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use super::parcel_config::PluginNode;

/// Represents fields in .parcelrc that use an object, mapping a pattern to a list of plugin names
///
/// # Examples
///
/// ```
/// use std::path::PathBuf;
/// use std::rc::Rc;
///
/// use indexmap::indexmap;
/// use parcel_config::pipeline::PipelineMap;
/// use parcel_config::PluginNode;
///
/// PipelineMap::new(indexmap! {
///   String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec![PluginNode {
///     package_name: String::from("@parcel/transformer-js"),
///     resolve_from: Rc::new(PathBuf::default()),
///   }]
/// });
/// ```
///
#[derive(Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct PipelineMap(
  /// Maps patterns to a series of plugins, called pipelines
  IndexMap<String, Vec<PluginNode>>,
);

impl PipelineMap {
  pub fn new(map: IndexMap<String, Vec<PluginNode>>) -> Self {
    Self(map)
  }

  /// Finds pipelines contained by a pattern that match the given file path and named pipeline
  ///
  /// This function will return an empty vector when a pipeline is provided and there are no exact
  /// matches. Otherwise, exact pattern matches will be returned followed by any other matching
  /// patterns.
  ///
  /// # Examples
  ///
  /// ```
  /// use std::path::PathBuf;
  /// use std::rc::Rc;
  ///
  /// use indexmap::indexmap;
  /// use parcel_config::pipeline::PipelineMap;
  /// use parcel_config::PluginNode;
  ///
  /// let pipeline_map = PipelineMap::new(indexmap! {
  ///   String::from("types:*.{ts,tsx}") => vec![PluginNode {
  ///     package_name: String::from("@parcel/transformer-typescript-types"),
  ///     resolve_from: Rc::new(PathBuf::default()),
  ///   }],
  ///   String::from("*.toml") => vec![PluginNode {
  ///     package_name: String::from("@parcel/transformer-toml"),
  ///     resolve_from: Rc::new(PathBuf::default()),
  ///   }],
  /// });
  ///
  /// pipeline_map.get(&PathBuf::from("component.tsx"), &Some("types"));
  /// pipeline_map.get(&PathBuf::from("Cargo.toml"), &None::<String>);
  /// ```
  pub fn get(&self, path: &Path, named_pipeline: &Option<impl AsRef<str>>) -> Vec<PluginNode> {
    let basename = path.file_name().unwrap().to_str().unwrap();
    let path = path.as_os_str().to_str().unwrap();
    let mut matches: Vec<PluginNode> = Vec::new();

    // If a pipeline is requested, a the glob needs to match exactly
    if let Some(pipeline) = named_pipeline {
      let exact_match = self
        .0
        .iter()
        .find(|(pattern, _)| is_match(pattern, path, basename, pipeline.as_ref()));

      if let Some((_, pipelines)) = exact_match {
        matches.extend(pipelines.iter().cloned());
      } else {
        return Vec::new();
      }
    }

    for (pattern, pipelines) in self.0.iter() {
      if is_match(&pattern, path, basename, "") {
        matches.extend(pipelines.iter().cloned());
      }
    }

    matches
  }

  pub fn contains_named_pipeline(&self, pipeline: impl AsRef<str>) -> bool {
    let named_pipeline = format!("{}:", pipeline.as_ref());

    self.0.keys().any(|glob| glob.starts_with(&named_pipeline))
  }

  pub fn named_pipelines(&self) -> Vec<&str> {
    self
      .0
      .keys()
      .filter_map(|glob| glob.split_once(':').map(|g| g.0))
      .collect()
  }
}

pub(crate) fn is_match(pattern: &str, path: &str, basename: &str, pipeline: &str) -> bool {
  let (pattern_pipeline, glob) = pattern.split_once(':').unwrap_or(("", pattern));
  pipeline == pattern_pipeline && (glob_match(glob, basename) || glob_match(glob, path))
}

#[cfg(test)]
mod tests {
  use std::path::PathBuf;
  use std::rc::Rc;

  use super::*;

  fn pipelines() -> Vec<PluginNode> {
    vec![PluginNode {
      package_name: String::from("@parcel/plugin-1"),
      resolve_from: Rc::new(PathBuf::default()),
    }]
  }

  fn pipelines_two() -> Vec<PluginNode> {
    vec![PluginNode {
      package_name: String::from("@parcel/plugin-2"),
      resolve_from: Rc::new(PathBuf::default()),
    }]
  }

  fn pipelines_three() -> Vec<PluginNode> {
    vec![PluginNode {
      package_name: String::from("@parcel/plugin-3"),
      resolve_from: Rc::new(PathBuf::default()),
    }]
  }

  mod get {
    use std::env;

    use indexmap::indexmap;

    use super::*;

    fn paths(filename: &str) -> Vec<PathBuf> {
      let cwd = env::current_dir().unwrap();
      vec![
        PathBuf::from(filename),
        cwd.join(filename),
        cwd.join("src").join(filename),
      ]
    }

    #[test]
    fn returns_empty_vec_for_empty_map() {
      let empty_map = PipelineMap::default();
      let empty_vec: Vec<PluginNode> = Vec::new();

      assert_eq!(
        empty_map.get(&PathBuf::from("a.js"), &None::<String>),
        empty_vec
      );

      assert_eq!(
        empty_map.get(&PathBuf::from("a.toml"), &None::<String>),
        empty_vec
      );
    }

    #[test]
    fn returns_empty_vec_when_no_matching_path() {
      let empty_pipeline: Option<&str> = None;
      let empty_vec: Vec<PluginNode> = Vec::new();
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines(),
        String::from("*.toml") => pipelines()
      });

      assert_eq!(map.get(&PathBuf::from("a.css"), &empty_pipeline), empty_vec);
      assert_eq!(map.get(&PathBuf::from("a.jsx"), &empty_pipeline), empty_vec);
      assert_eq!(map.get(&PathBuf::from("a.tsx"), &empty_pipeline), empty_vec);
      assert_eq!(map.get(&PathBuf::from("a.tom"), &empty_pipeline), empty_vec);
      assert_eq!(
        map.get(&PathBuf::from("a.tomla"), &empty_pipeline),
        empty_vec
      );
    }

    #[test]
    fn returns_empty_vec_when_no_matching_pipeline() {
      let empty_vec: Vec<PluginNode> = Vec::new();
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines(),
        String::from("*.toml") => pipelines(),
        String::from("types:*.{ts,tsx}") => pipelines(),
        String::from("url:*") => pipelines_two()
      });

      assert_eq!(map.get(&PathBuf::from("a.css"), &Some("css")), empty_vec);
      assert_eq!(map.get(&PathBuf::from("a.jsx"), &Some("jsx")), empty_vec);
      assert_eq!(map.get(&PathBuf::from("a.tsx"), &Some("tsx")), empty_vec);
      assert_eq!(map.get(&PathBuf::from("a.ts"), &Some("typesa")), empty_vec);
      assert_eq!(
        map.get(&PathBuf::from("a.js"), &Some("data-url")),
        empty_vec
      );
    }

    #[test]
    fn returns_matching_plugins_for_empty_pipeline() {
      let empty_pipeline: Option<&str> = None;
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines(),
        String::from("*.toml") => pipelines_two()
      });

      for path in paths("a.js") {
        assert_eq!(map.get(&path, &empty_pipeline), pipelines());
      }

      for path in paths("a.ts") {
        assert_eq!(map.get(&path, &empty_pipeline), pipelines());
      }

      for path in paths("a.toml") {
        assert_eq!(map.get(&path, &empty_pipeline), pipelines_two());
      }
    }

    #[test]
    fn returns_matching_plugins_for_pipeline() {
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines_three(),
        String::from("*.toml") => pipelines_three(),
        String::from("types:*.{ts,tsx}") => pipelines(),
        String::from("url:*") => pipelines_two()
      });

      let expected_ts: Vec<PluginNode> = [pipelines(), pipelines_three()].concat();
      for path in paths("a.ts") {
        assert_eq!(map.get(&path, &Some("types")), expected_ts);
      }

      for path in paths("a.tsx") {
        assert_eq!(map.get(&path, &Some("types")), pipelines());
      }

      for path in paths("a.url") {
        assert_eq!(map.get(&path, &Some("url")), pipelines_two());
      }
    }
  }

  mod contains_named_pipeline {
    use indexmap::indexmap;

    use super::*;

    #[test]
    fn returns_true_when_named_pipeline_exists() {
      let map = PipelineMap::new(indexmap! {
        String::from("data-url:*") => pipelines()
      });

      assert_eq!(map.contains_named_pipeline("data-url"), true);
    }

    #[test]
    fn returns_false_for_empty_map() {
      let empty_map = PipelineMap::default();

      assert_eq!(empty_map.contains_named_pipeline("data-url"), false);
      assert_eq!(empty_map.contains_named_pipeline("types"), false);
    }

    #[test]
    fn returns_false_when_named_pipeline_does_not_exist() {
      let map = PipelineMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines(),
        String::from("*.toml") => pipelines(),
        String::from("url:*") => pipelines()
      });

      assert_eq!(map.contains_named_pipeline("*"), false);
      assert_eq!(map.contains_named_pipeline("data-url"), false);
      assert_eq!(map.contains_named_pipeline("types"), false);
      assert_eq!(map.contains_named_pipeline("urls"), false);
    }
  }

  mod named_pipelines {
    use indexmap::indexmap;

    use super::*;

    #[test]
    fn returns_empty_vec_when_no_named_pipelines() {
      let empty_vec: Vec<&str> = Vec::new();

      assert_eq!(PipelineMap::default().named_pipelines(), empty_vec);
      assert_eq!(
        PipelineMap::new(indexmap! {
          String::from("*.{js,ts}") => pipelines(),
          String::from("*.toml") => pipelines(),
        })
        .named_pipelines(),
        empty_vec,
      );
    }

    #[test]
    fn returns_list_of_named_pipelines() {
      assert_eq!(
        PipelineMap::new(indexmap! {
          String::from("data-url:*") => pipelines()
        })
        .named_pipelines(),
        vec!("data-url")
      );

      assert_eq!(
        PipelineMap::new(indexmap! {
          String::from("types:*.{ts,tsx}") => pipelines()
        })
        .named_pipelines(),
        vec!("types")
      );

      assert_eq!(
        PipelineMap::new(indexmap! {
          String::from("url:*") => pipelines()
        })
        .named_pipelines(),
        vec!("url")
      );

      assert_eq!(
        PipelineMap::new(indexmap! {
          String::from("*.{js,ts}") => pipelines(),
          String::from("*.toml") => pipelines(),
          String::from("bundle-text:*") => pipelines(),
          String::from("data-url:*") => pipelines(),
          String::from("types:*.{ts,tsx}") => pipelines(),
          String::from("url:*") => pipelines()
        })
        .named_pipelines(),
        vec!("bundle-text", "data-url", "types", "url")
      );
    }
  }
}
