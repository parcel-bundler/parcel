use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::Serialize;

use super::named_pattern_matcher;
use crate::PluginNode;

//
pub struct NamedPattern<'a> {
  /// The name of the pipeline
  ///
  /// For example, this could be "js", "toml", "ts", etc
  ///
  pub pipeline: &'a str,

  /// Whether an unnamed pipeline pattern can be included in the result
  pub use_fallback: bool,
}

/// Represents fields in .parcelrc that map a pattern or named pattern to a list of plugin names
///
/// # Examples
///
/// ```
/// use std::path::PathBuf;
/// use std::sync::Arc;
///
/// use indexmap::indexmap;
/// use parcel_config::map::NamedPipelinesMap;
/// use parcel_config::PluginNode;
///
/// NamedPipelinesMap::new(indexmap! {
///   String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec![PluginNode {
///     package_name: String::from("@parcel/transformer-js"),
///     resolve_from: Arc::new(PathBuf::default()),
///   }]
/// });
/// ```
///
#[derive(Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(transparent)]
pub struct NamedPipelinesMap {
  /// Maps patterns and named patterns to a series of plugins, called pipelines
  inner: IndexMap<String, Vec<PluginNode>>,
}

impl Hash for NamedPipelinesMap {
  fn hash<H: Hasher>(&self, state: &mut H) {
    for item in self.inner.iter() {
      item.hash(state);
    }
  }
}

impl NamedPipelinesMap {
  pub fn new(map: IndexMap<String, Vec<PluginNode>>) -> Self {
    Self { inner: map }
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
  /// use std::path::Path;
  /// use std::path::PathBuf;
  /// use std::sync::Arc;
  ///
  /// use indexmap::indexmap;
  /// use parcel_config::map::NamedPattern;
  /// use parcel_config::map::NamedPipelinesMap;
  /// use parcel_config::PluginNode;
  ///
  /// let pipelines_map = NamedPipelinesMap::new(indexmap! {
  ///   String::from("types:*.{ts,tsx}") => vec![PluginNode {
  ///     package_name: String::from("@parcel/transformer-typescript-types"),
  ///     resolve_from: Arc::new(PathBuf::default()),
  ///   }],
  ///   String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec![PluginNode {
  ///     package_name: String::from("@parcel/transformer-js"),
  ///     resolve_from: Arc::new(PathBuf::default()),
  ///   }],
  /// });
  ///
  /// pipelines_map.get(Path::new("component.tsx"), None);
  ///
  /// pipelines_map.get(
  ///   Path::new("component.tsx"),
  ///   Some(NamedPattern {
  ///     pipeline: "types",
  ///     use_fallback: false,
  ///   })
  /// );
  ///
  /// pipelines_map.get(
  ///   Path::new("component.tsx"),
  ///   Some(NamedPattern {
  ///     pipeline: "types",
  ///     use_fallback: true,
  ///   })
  /// );
  /// ```
  pub fn get(&self, path: &Path, named_pattern: Option<NamedPattern>) -> Vec<PluginNode> {
    let is_match = named_pattern_matcher(path);
    let mut matches: Vec<PluginNode> = Vec::new();

    // If a named pipeline is requested, the glob needs to match exactly
    if let Some(named_pattern) = named_pattern {
      let exact_match = self
        .inner
        .iter()
        .find(|(pattern, _)| is_match(pattern, named_pattern.pipeline.as_ref()));

      if let Some((_, pipelines)) = exact_match {
        matches.extend(pipelines.iter().cloned());
      } else if !named_pattern.use_fallback {
        return Vec::new();
      }
    }

    for (pattern, pipelines) in self.inner.iter() {
      if is_match(&pattern, "") {
        matches.extend(pipelines.iter().cloned());
      }
    }

    matches
  }

  pub fn contains_named_pipeline(&self, pipeline: impl AsRef<str>) -> bool {
    let named_pipeline = format!("{}:", pipeline.as_ref());

    self
      .inner
      .keys()
      .any(|glob| glob.starts_with(&named_pipeline))
  }

  pub fn named_pipelines(&self) -> Vec<String> {
    self
      .inner
      .keys()
      .filter_map(|glob| {
        glob
          .split_once(':')
          .map(|(named_pipeline, _pattern)| String::from(named_pipeline))
      })
      .collect()
  }
}

#[cfg(test)]
mod tests {
  use std::path::PathBuf;
  use std::sync::Arc;

  use super::*;

  fn pipelines(name: &str) -> Vec<PluginNode> {
    vec![PluginNode {
      package_name: format!("@parcel/plugin-{}", name),
      resolve_from: Arc::new(PathBuf::default()),
    }]
  }

  mod get {
    use indexmap::indexmap;

    use super::*;

    #[test]
    fn returns_empty_vec_for_empty_map() {
      let empty_map = NamedPipelinesMap::default();

      assert_eq!(empty_map.get(Path::new("a.js"), None), Vec::new());
      assert_eq!(empty_map.get(Path::new("a.toml"), None), Vec::new());
    }

    #[test]
    fn returns_empty_vec_when_no_matching_path() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("*.toml") => pipelines("2")
      });

      assert_eq!(map.get(Path::new("a.css"), None), Vec::new());
      assert_eq!(map.get(Path::new("a.jsx"), None), Vec::new());
      assert_eq!(map.get(Path::new("a.tsx"), None), Vec::new());
      assert_eq!(map.get(Path::new("a.tom"), None), Vec::new());
      assert_eq!(map.get(Path::new("a.tomla"), None), Vec::new());
    }

    #[test]
    fn returns_empty_vec_when_no_matching_pipeline_without_fallback() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("*.toml") => pipelines("2"),
        String::from("types:*.{ts,tsx}") => pipelines("3"),
        String::from("url:*") => pipelines("4")
      });

      let assert_empty_vec = |path: &str, pipeline: &str| {
        assert_eq!(
          map.get(
            Path::new(path),
            Some(NamedPattern {
              pipeline,
              use_fallback: false
            })
          ),
          Vec::new()
        );
      };

      assert_empty_vec("a.css", "css");

      assert_empty_vec("a.js", "data-url");
      assert_empty_vec("a.js", "urla");

      assert_empty_vec("a.toml", "toml");

      assert_empty_vec("a.ts", "typesa");
      assert_empty_vec("a.tsx", "typesa");
    }

    #[test]
    fn returns_empty_vec_when_no_matching_pipeline_with_fallback() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("types:*.{ts,tsx}") => pipelines("3"),
      });

      let assert_empty_vec = |path: &str, pipeline: &str| {
        assert_eq!(
          map.get(
            Path::new(path),
            Some(NamedPattern {
              pipeline,
              use_fallback: true
            })
          ),
          Vec::new()
        );
      };

      assert_empty_vec("a.css", "css");
      assert_empty_vec("a.jsx", "typesa");
      assert_empty_vec("a.tsx", "typesa");
    }

    #[test]
    fn returns_matching_plugins_for_empty_pipeline() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("*.toml") => pipelines("2")
      });

      assert_eq!(map.get(Path::new("a.js"), None), pipelines("1"));
      assert_eq!(map.get(Path::new("a.ts"), None), pipelines("1"));
      assert_eq!(map.get(Path::new("a.toml"), None), pipelines("2"));
    }

    #[test]
    fn returns_matching_plugins_for_pipeline_without_fallback() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("types:*.{ts,tsx}") => pipelines("2"),
        String::from("url:*") => pipelines("3")
      });

      let assert_plugins = |path: &str, pipeline: &str, plugins: Vec<PluginNode>| {
        assert_eq!(
          map.get(
            Path::new(path),
            Some(NamedPattern {
              pipeline,
              use_fallback: false
            })
          ),
          plugins
        );
      };

      assert_plugins("a.ts", "types", [pipelines("2"), pipelines("1")].concat());
      assert_plugins("a.tsx", "types", pipelines("2"));

      assert_plugins("a.js", "url", [pipelines("3"), pipelines("1")].concat());
      assert_plugins("a.url", "url", pipelines("3"));
    }

    #[test]
    fn returns_matching_plugins_for_pipeline_with_fallback() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("types:*.{ts,tsx}") => pipelines("2"),
        String::from("url:*") => pipelines("3")
      });

      let assert_plugins = |path: &str, pipeline: &str, plugins: Vec<PluginNode>| {
        assert_eq!(
          map.get(
            Path::new(path),
            Some(NamedPattern {
              pipeline,
              use_fallback: true
            })
          ),
          plugins
        );
      };

      assert_plugins("a.ts", "types", [pipelines("2"), pipelines("1")].concat());
      assert_plugins("a.tsx", "types", pipelines("2"));
      assert_plugins("a.ts", "typesa", pipelines("1"));

      assert_plugins("a.url", "url", pipelines("3"));
      assert_plugins("a.js", "url", [pipelines("3"), pipelines("1")].concat());
      assert_plugins("a.js", "urla", pipelines("1"));
    }
  }

  mod contains_named_pipeline {
    use indexmap::indexmap;

    use super::*;

    #[test]
    fn returns_true_when_named_pipeline_exists() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("data-url:*") => pipelines("1")
      });

      assert_eq!(map.contains_named_pipeline("data-url"), true);
    }

    #[test]
    fn returns_false_for_empty_map() {
      let empty_map = NamedPipelinesMap::default();

      assert_eq!(empty_map.contains_named_pipeline("data-url"), false);
      assert_eq!(empty_map.contains_named_pipeline("types"), false);
    }

    #[test]
    fn returns_false_when_named_pipeline_does_not_exist() {
      let map = NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,ts}") => pipelines("1"),
        String::from("*.toml") => pipelines("2"),
        String::from("url:*") => pipelines("3")
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

      assert_eq!(NamedPipelinesMap::default().named_pipelines(), empty_vec);
      assert_eq!(
        NamedPipelinesMap::new(indexmap! {
          String::from("*.{js,ts}") => pipelines("1"),
          String::from("*.toml") => pipelines("2"),
        })
        .named_pipelines(),
        empty_vec,
      );
    }

    #[test]
    fn returns_list_of_named_pipelines() {
      assert_eq!(
        NamedPipelinesMap::new(indexmap! {
          String::from("data-url:*") => pipelines("1")
        })
        .named_pipelines(),
        vec!("data-url")
      );

      assert_eq!(
        NamedPipelinesMap::new(indexmap! {
          String::from("types:*.{ts,tsx}") => pipelines("1")
        })
        .named_pipelines(),
        vec!("types")
      );

      assert_eq!(
        NamedPipelinesMap::new(indexmap! {
          String::from("url:*") => pipelines("1")
        })
        .named_pipelines(),
        vec!("url")
      );

      assert_eq!(
        NamedPipelinesMap::new(indexmap! {
          String::from("*.{js,ts}") => pipelines("1"),
          String::from("*.toml") => pipelines("2"),
          String::from("bundle-text:*") => pipelines("3"),
          String::from("data-url:*") => pipelines("4"),
          String::from("types:*.{ts,tsx}") => pipelines("5"),
          String::from("url:*") => pipelines("6")
        })
        .named_pipelines(),
        vec!("bundle-text", "data-url", "types", "url")
      );
    }
  }
}
