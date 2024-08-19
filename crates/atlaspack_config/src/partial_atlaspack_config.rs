use std::collections::HashSet;
use std::sync::Arc;

use atlaspack_core::types::DiagnosticError;
use derive_builder::Builder;
use indexmap::IndexMap;

use super::atlaspack_config::PluginNode;
use super::atlaspack_rc::AtlaspackRcFile;

/// An intermediate representation of the .atlaspackrc config
///
/// This data structure is used to perform configuration merging, to eventually create a compelete AtlaspackConfig.
///
#[derive(Clone, Debug, Default, Builder, PartialEq)]
#[builder(default)]
pub struct PartialAtlaspackConfig {
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

impl TryFrom<AtlaspackRcFile> for PartialAtlaspackConfig {
  type Error = DiagnosticError;

  fn try_from(file: AtlaspackRcFile) -> Result<PartialAtlaspackConfig, Self::Error> {
    // TODO Add validation here: multiple ..., plugin name format, reserved pipelines, etc

    let resolve_from = Arc::new(file.path.clone());

    let to_entry = |package_name: &String| PluginNode {
      package_name: String::from(package_name),
      resolve_from: resolve_from.clone(),
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

    Ok(PartialAtlaspackConfig {
      bundler: file
        .contents
        .bundler
        .as_ref()
        .map(|package_name| PluginNode {
          package_name: String::from(package_name),
          resolve_from: resolve_from.clone(),
        }),
      compressors: to_pipelines(file.contents.compressors.as_ref()),
      namers: to_vec(file.contents.namers.as_ref()),
      optimizers: to_pipelines(file.contents.optimizers.as_ref()),
      packagers: to_pipeline(file.contents.packagers.as_ref()),
      reporters: to_vec(file.contents.reporters.as_ref()),
      resolvers: to_vec(file.contents.resolvers.as_ref()),
      runtimes: to_vec(file.contents.runtimes.as_ref()),
      transformers: to_pipelines(file.contents.transformers.as_ref()),
      validators: to_pipelines(file.contents.validators.as_ref()),
    })
  }
}

impl PartialAtlaspackConfig {
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
    PartialAtlaspackConfig::merge_map(map, extend_map, |map, _extend_map| map)
  }

  fn merge_pipelines_map(
    from_map: IndexMap<String, Vec<PluginNode>>,
    extend_map: IndexMap<String, Vec<PluginNode>>,
  ) -> IndexMap<String, Vec<PluginNode>> {
    PartialAtlaspackConfig::merge_map(
      from_map,
      extend_map,
      PartialAtlaspackConfig::merge_pipelines,
    )
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

  pub fn merge(from_config: PartialAtlaspackConfig, extend_config: PartialAtlaspackConfig) -> Self {
    PartialAtlaspackConfig {
      bundler: from_config.bundler.or(extend_config.bundler),
      compressors: PartialAtlaspackConfig::merge_pipelines_map(
        from_config.compressors,
        extend_config.compressors,
      ),
      namers: PartialAtlaspackConfig::merge_pipelines(from_config.namers, extend_config.namers),
      optimizers: PartialAtlaspackConfig::merge_pipelines_map(
        from_config.optimizers,
        extend_config.optimizers,
      ),
      packagers: PartialAtlaspackConfig::merge_pipeline_map(
        from_config.packagers,
        extend_config.packagers,
      ),
      reporters: PartialAtlaspackConfig::merge_pipelines(
        from_config.reporters,
        extend_config.reporters,
      ),
      resolvers: PartialAtlaspackConfig::merge_pipelines(
        from_config.resolvers,
        extend_config.resolvers,
      ),
      runtimes: PartialAtlaspackConfig::merge_pipelines(
        from_config.runtimes,
        extend_config.runtimes,
      ),
      transformers: PartialAtlaspackConfig::merge_pipelines_map(
        from_config.transformers,
        extend_config.transformers,
      ),
      validators: PartialAtlaspackConfig::merge_pipelines_map(
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
      use std::sync::Arc;

      use super::*;

      #[test]
      fn uses_from_when_extend_missing() {
        let from = PartialAtlaspackConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("a"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let extend = PartialAtlaspackConfig::default();
        let expected = from.clone();

        assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
      }

      #[test]
      fn uses_extend_when_from_missing() {
        let from = PartialAtlaspackConfig::default();
        let extend = PartialAtlaspackConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("a"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let expected = extend.clone();

        assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
      }

      #[test]
      fn merges_using_from() {
        let from = PartialAtlaspackConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("a"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let extend = PartialAtlaspackConfigBuilder::default()
          .bundler(Some(PluginNode {
            package_name: String::from("b"),
            resolve_from: Arc::new(PathBuf::from("/")),
          }))
          .build()
          .unwrap();

        let expected = from.clone();

        assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
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
            let from = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend = PartialAtlaspackConfig::default();
            let expected = from.clone();

            assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
          }

          #[test]
          fn uses_extend_when_from_missing() {
            let from = PartialAtlaspackConfig::default();
            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let expected = extend.clone();

            assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_patterns() {
            let from = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("a"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.{cjs,js,mjs}") => vec!(PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("~")),
                })
              })
              .build()
              .unwrap();

            assert_eq!(
              PartialAtlaspackConfig::merge(from, extend),
              PartialAtlaspackConfigBuilder::default()
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
            let from = PartialAtlaspackConfigBuilder::default()
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

            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("c"),
                  resolve_from: Arc::new(PathBuf::from("/")),
                })
              })
              .build()
              .unwrap();

            let expected = from.clone();

            assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_pipelines_with_dot_dot_dot() {
            let from = PartialAtlaspackConfigBuilder::default()
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

            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("~")),
                })
              })
              .build()
              .unwrap();

            assert_eq!(
              PartialAtlaspackConfig::merge(from, extend),
              PartialAtlaspackConfigBuilder::default()
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
            let from = PartialAtlaspackConfigBuilder::default()
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

            let extend_1 = PartialAtlaspackConfig::default();
            let extend_2 = PartialAtlaspackConfigBuilder::default()
              .$property(indexmap! {
                String::from("*.js") => vec!(PluginNode {
                  package_name: String::from("b"),
                  resolve_from: Arc::new(PathBuf::from("~")),
                })
              })
              .build()
              .unwrap();

            assert_eq!(
              PartialAtlaspackConfig::merge(
                PartialAtlaspackConfig::merge(from, extend_1),
                extend_2
              ),
              PartialAtlaspackConfigBuilder::default()
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
            let from = PartialAtlaspackConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("a"),
                resolve_from: Arc::new(PathBuf::from("/")),
              }])
              .build()
              .unwrap();

            let extend = PartialAtlaspackConfig::default();
            let expected = from.clone();

            assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
          }

          #[test]
          fn uses_extend_when_from_missing() {
            let from = PartialAtlaspackConfig::default();
            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("a"),
                resolve_from: Arc::new(PathBuf::from("/")),
              }])
              .build()
              .unwrap();

            let expected = extend.clone();

            assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_pipelines_with_missing_dot_dot_dot() {
            let from = PartialAtlaspackConfigBuilder::default()
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

            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("c"),
                resolve_from: Arc::new(PathBuf::from("/")),
              }])
              .build()
              .unwrap();

            let expected = from.clone();

            assert_eq!(PartialAtlaspackConfig::merge(from, extend), expected);
          }

          #[test]
          fn merges_pipelines_with_dot_dot_dot() {
            let from = PartialAtlaspackConfigBuilder::default()
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

            let extend = PartialAtlaspackConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("b"),
                resolve_from: Arc::new(PathBuf::from("~")),
              }])
              .build()
              .unwrap();

            assert_eq!(
              PartialAtlaspackConfig::merge(from, extend),
              PartialAtlaspackConfigBuilder::default()
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
            let from = PartialAtlaspackConfigBuilder::default()
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

            let extend_1 = PartialAtlaspackConfig::default();
            let extend_2 = PartialAtlaspackConfigBuilder::default()
              .$property(vec![PluginNode {
                package_name: String::from("b"),
                resolve_from: Arc::new(PathBuf::from("~")),
              }])
              .build()
              .unwrap();

            assert_eq!(
              PartialAtlaspackConfig::merge(
                PartialAtlaspackConfig::merge(from, extend_1),
                extend_2
              ),
              PartialAtlaspackConfigBuilder::default()
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
