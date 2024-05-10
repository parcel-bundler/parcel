use std::collections::HashSet;
use std::sync::Arc;

use derive_builder::Builder;
use indexmap::IndexMap;

use super::parcel_config::PluginNode;
use super::parcel_rc::ParcelRcFile;
use crate::config_error::ConfigError;

/// An intermediate representation of the .parcelrc config
///
/// This data structure is used to perform configuration merging, to eventually create a compelete ParcelConfig.
///
#[derive(Clone, Debug, Default, Builder, PartialEq)]
#[builder(default)]
pub struct PartialParcelConfig {
  pub bundler: Option<PluginNode>,
  pub compressors: IndexMap<String, Vec<PluginNode>>,
  pub namers: Vec<PluginNode>,
  pub optimizers: IndexMap<String, Vec<PluginNode>>,
  pub packagers: IndexMap<String, PluginNode>,
  pub reporters: Vec<PluginNode>,
  pub resolvers: Vec<PluginNode>,
  pub runtimes: Vec<PluginNode>,
  pub transformers: IndexMap<String, Vec<PluginNode>>,
  pub validators: IndexMap<String, Vec<PluginNode>>,
}

impl TryFrom<&ParcelRcFile> for PartialParcelConfig {
  type Error = ConfigError;

  fn try_from(parcel_rc: &ParcelRcFile) -> Result<PartialParcelConfig, ConfigError> {
    // TODO Add validation here: multiple ..., plugin name format, reserved pipelines, etc

    let resolve_from = Arc::new(parcel_rc.path.clone());

    let to_entry = |package_name: &String| PluginNode {
      package_name: String::from(package_name),
      resolve_from: Arc::clone(&resolve_from),
    };

    let to_vec = |maybe_plugins: Option<&Vec<String>>| {
      maybe_plugins
        .map(|plugins| plugins.iter().map(to_entry).collect())
        .unwrap_or(Vec::new())
    };

    let to_pipelines = |map: Option<&IndexMap<String, Vec<String>>>| {
      map
        .map(|plugins| {
          plugins
            .iter()
            .map(|(pattern, plugins)| {
              (
                String::from(pattern),
                plugins.iter().map(to_entry).collect(),
              )
            })
            .collect()
        })
        .unwrap_or(IndexMap::new())
    };

    let to_pipeline = |map: Option<&IndexMap<String, String>>| {
      map
        .map(|plugins| {
          plugins
            .iter()
            .map(|(pattern, package_name)| (String::from(pattern), to_entry(package_name)))
            .collect()
        })
        .unwrap_or(IndexMap::new())
    };

    Ok(PartialParcelConfig {
      bundler: parcel_rc
        .contents
        .bundler
        .as_ref()
        .map(|package_name| PluginNode {
          package_name: String::from(package_name),
          resolve_from: Arc::clone(&resolve_from),
        }),
      compressors: to_pipelines(parcel_rc.contents.compressors.as_ref()),
      namers: to_vec(parcel_rc.contents.namers.as_ref()),
      optimizers: to_pipelines(parcel_rc.contents.optimizers.as_ref()),
      packagers: to_pipeline(parcel_rc.contents.packagers.as_ref()),
      reporters: to_vec(parcel_rc.contents.reporters.as_ref()),
      resolvers: to_vec(parcel_rc.contents.resolvers.as_ref()),
      runtimes: to_vec(parcel_rc.contents.runtimes.as_ref()),
      transformers: to_pipelines(parcel_rc.contents.transformers.as_ref()),
      validators: to_pipelines(parcel_rc.contents.validators.as_ref()),
    })
  }
}

impl PartialParcelConfig {
  fn merge_map<T: Clone>(
    map: IndexMap<String, T>,
    extend_map: IndexMap<String, T>,
    merge: fn(map: T, extend_map: T) -> T,
  ) -> IndexMap<String, T> {
    if extend_map.is_empty() {
      return map;
    }

    if map.is_empty() {
      return extend_map;
    }

    let mut merged_map = IndexMap::new();
    let mut used_patterns = HashSet::new();

    // Add the extension options first so they have higher precedence in the output glob map
    for (pattern, extend_pipelines) in extend_map {
      let map_pipelines = map.get(&pattern);
      if let Some(pipelines) = map_pipelines {
        used_patterns.insert(pattern.clone());
        merged_map.insert(pattern, merge(pipelines.clone(), extend_pipelines));
      } else {
        merged_map.insert(pattern, extend_pipelines);
      }
    }

    // Add remaining pipelines
    for (pattern, value) in map {
      if !used_patterns.contains(&pattern) {
        merged_map.insert(String::from(pattern), value);
      }
    }

    merged_map
  }

  fn merge_pipeline_map(
    map: IndexMap<String, PluginNode>,
    extend_map: IndexMap<String, PluginNode>,
  ) -> IndexMap<String, PluginNode> {
    PartialParcelConfig::merge_map(map, extend_map, |map, _extend_map| map)
  }

  fn merge_pipelines_map(
    from_map: IndexMap<String, Vec<PluginNode>>,
    extend_map: IndexMap<String, Vec<PluginNode>>,
  ) -> IndexMap<String, Vec<PluginNode>> {
    PartialParcelConfig::merge_map(from_map, extend_map, PartialParcelConfig::merge_pipelines)
  }

  fn merge_pipelines(
    from_pipelines: Vec<PluginNode>,
    extend_pipelines: Vec<PluginNode>,
  ) -> Vec<PluginNode> {
    if extend_pipelines.is_empty() {
      return from_pipelines;
    }

    if from_pipelines.is_empty() {
      return extend_pipelines;
    }

    let spread_index = from_pipelines
      .iter()
      .position(|plugin| plugin.package_name == "...");

    match spread_index {
      None => from_pipelines,
      Some(index) => {
        let extend_pipelines = extend_pipelines.as_slice();

        [
          &from_pipelines[..index],
          extend_pipelines,
          &from_pipelines[(index + 1)..],
        ]
        .concat()
      }
    }
  }

  pub fn merge(from_config: PartialParcelConfig, extend_config: PartialParcelConfig) -> Self {
    PartialParcelConfig {
      bundler: from_config.bundler.or(extend_config.bundler),
      compressors: PartialParcelConfig::merge_pipelines_map(
        from_config.compressors,
        extend_config.compressors,
      ),
      namers: PartialParcelConfig::merge_pipelines(from_config.namers, extend_config.namers),
      optimizers: PartialParcelConfig::merge_pipelines_map(
        from_config.optimizers,
        extend_config.optimizers,
      ),
      packagers: PartialParcelConfig::merge_pipeline_map(
        from_config.packagers,
        extend_config.packagers,
      ),
      reporters: PartialParcelConfig::merge_pipelines(
        from_config.reporters,
        extend_config.reporters,
      ),
      resolvers: PartialParcelConfig::merge_pipelines(
        from_config.resolvers,
        extend_config.resolvers,
      ),
      runtimes: PartialParcelConfig::merge_pipelines(from_config.runtimes, extend_config.runtimes),
      transformers: PartialParcelConfig::merge_pipelines_map(
        from_config.transformers,
        extend_config.transformers,
      ),
      validators: PartialParcelConfig::merge_pipelines_map(
        from_config.validators,
        extend_config.validators,
      ),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  mod merge {
    use super::*;

    mod bundler {
      use std::path::PathBuf;

      use super::*;

      #[test]
      fn uses_from_when_extend_missing() {
        let from = PartialParcelConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("a"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let extend = PartialParcelConfig::default();
        let expected = from.clone();

        assert_eq!(PartialParcelConfig::merge(from, extend), expected);
      }

      #[test]
      fn uses_extend_when_from_missing() {
        let from = PartialParcelConfig::default();
        let extend = PartialParcelConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("a"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let expected = extend.clone();

        assert_eq!(PartialParcelConfig::merge(from, extend), expected);
      }

      #[test]
      fn merges_using_from() {
        let from = PartialParcelConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("a"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let extend = PartialParcelConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("b"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let expected = from.clone();

        assert_eq!(PartialParcelConfig::merge(from, extend), expected);
      }
    }

    macro_rules! test_pipeline_map {
      ($property: ident) => {
        #[cfg(test)]
        mod $property {
          use std::path::PathBuf;

          use indexmap::indexmap;

          use super::*;

          #[test]
          fn uses_from_when_extend_missing() {
            let from = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend = PartialParcelConfig::default();
            let expected = from.clone();

            assert_eq!(PartialParcelConfig::merge(from, extend), expected);
          }

          #[test]
          fn uses_extend_when_from_missing() {
            let from = PartialParcelConfig::default();
            let extend = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let expected = extend.clone();

            assert_eq!(PartialParcelConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_patterns() {
            let from = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.{cjs,js,mjs}") => vec!(PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("~")),
                })
              })
              .build()
              .unwrap();

            assert_eq!(
              PartialParcelConfig::merge(from, extend),
              PartialParcelConfigBuilder::default()
                .$property(indexmap! {
                  String::from("*.js") => vec!(PluginNode {
                    package_name: String::from("a"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  }),
                  String::from("*.{cjs,js,mjs}") => vec!(PluginNode {
                    package_name: String::from("b"),
                    resolve_from: Arc::new(PathBuf::from("~")),
                  }),
                })
                .build()
                .unwrap()
            );
          }

          #[test]
          fn merges_pipelines_with_missing_dot_dot_dot() {
            let from = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                }, PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("c"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let expected = from.clone();

            assert_eq!(PartialParcelConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_pipelines_with_dot_dot_dot() {
            let from = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("..."),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("c"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("~")),
                })
              })
              .build()
              .unwrap();

            assert_eq!(
              PartialParcelConfig::merge(from, extend),
              PartialParcelConfigBuilder::default()
                .$property(indexmap! {
                  String::from("*.js") => vec!(PluginNode {
                    package_name: String::from("a"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  },
                  PluginNode {
                    package_name: String::from("b"),
                    resolve_from: Arc::new(PathBuf::from("~")),
                  },
                  PluginNode {
                    package_name: String::from("c"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  })
                })
                .build()
                .unwrap()
            );
          }

          #[test]
          fn merges_pipelines_with_dot_dot_dot_match_in_grandparent() {
            let from = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("..."),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("c"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend_1 = PartialParcelConfig::default();
            let extend_2 = PartialParcelConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("~")),
                })
              })
              .build()
              .unwrap();

            assert_eq!(
              PartialParcelConfig::merge(PartialParcelConfig::merge(from, extend_1), extend_2),
              PartialParcelConfigBuilder::default()
                .$property(indexmap! {
                  String::from("*.js") => vec!(PluginNode {
                    package_name: String::from("a"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  },
                  PluginNode {
                    package_name: String::from("b"),
                    resolve_from: Arc::new(PathBuf::from("~")),
                  },
                  PluginNode {
                    package_name: String::from("c"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  })
                })
                .build()
                .unwrap()
            );
          }
        }
      };
    }

    macro_rules! test_pipelines {
      ($property: ident) => {
        #[cfg(test)]
        mod $property {
          use std::path::PathBuf;

          use super::*;

          #[test]
          fn uses_from_when_extend_missing() {
            let from = PartialParcelConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("a"),
                resolve_from: Arc::new(PathBuf::from("/")),
              }])
              .build()
              .unwrap();

            let extend = PartialParcelConfig::default();
            let expected = from.clone();

            assert_eq!(PartialParcelConfig::merge(from, extend), expected);
          }

          #[test]
          fn uses_extend_when_from_missing() {
            let from = PartialParcelConfig::default();
            let extend = PartialParcelConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("a"),
                resolve_from: Arc::new(PathBuf::from("/")),
              }])
              .build()
              .unwrap();

            let expected = extend.clone();

            assert_eq!(PartialParcelConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_pipelines_with_missing_dot_dot_dot() {
            let from = PartialParcelConfigBuilder::default()
              .$property(vec![
                PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
              ])
              .build()
              .unwrap();

            let extend = PartialParcelConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("c"),
                resolve_from: Arc::new(PathBuf::from("/")),
              }])
              .build()
              .unwrap();

            let expected = from.clone();

            assert_eq!(PartialParcelConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_pipelines_with_dot_dot_dot() {
            let from = PartialParcelConfigBuilder::default()
              .$property(vec![
                PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("..."),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("c"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
              ])
              .build()
              .unwrap();

            let extend = PartialParcelConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("b"),
                resolve_from: Arc::new(PathBuf::from("~")),
              }])
              .build()
              .unwrap();

            assert_eq!(
              PartialParcelConfig::merge(from, extend),
              PartialParcelConfigBuilder::default()
                .$property(vec!(
                  PluginNode {
                    package_name: String::from("a"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  },
                  PluginNode {
                    package_name: String::from("b"),
                    resolve_from: Arc::new(PathBuf::from("~")),
                  },
                  PluginNode {
                    package_name: String::from("c"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  }
                ))
                .build()
                .unwrap()
            );
          }

          #[test]
          fn merges_pipelines_with_dot_dot_dot_match_in_grandparent() {
            let from = PartialParcelConfigBuilder::default()
              .$property(vec![
                PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("..."),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
                PluginNode {
                  package_name: String::from("c"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                },
              ])
              .build()
              .unwrap();

            let extend_1 = PartialParcelConfig::default();
            let extend_2 = PartialParcelConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("b"),
                resolve_from: Arc::new(PathBuf::from("~")),
              }])
              .build()
              .unwrap();

            assert_eq!(
              PartialParcelConfig::merge(PartialParcelConfig::merge(from, extend_1), extend_2),
              PartialParcelConfigBuilder::default()
                .$property(vec!(
                  PluginNode {
                    package_name: String::from("a"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  },
                  PluginNode {
                    package_name: String::from("b"),
                    resolve_from: Arc::new(PathBuf::from("~")),
                  },
                  PluginNode {
                    package_name: String::from("c"),
                    resolve_from: Arc::new(PathBuf::from("/")),
                  }
                ))
                .build()
                .unwrap()
            );
          }
        }
      };
    }

    test_pipeline_map!(compressors);
    test_pipelines!(namers);
    test_pipeline_map!(optimizers);
    test_pipelines!(reporters);
    test_pipelines!(resolvers);
    test_pipelines!(runtimes);
    test_pipeline_map!(transformers);
    test_pipeline_map!(validators);
  }
}
