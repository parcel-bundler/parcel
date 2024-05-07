use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;

use glob_match::glob_match;
use indexmap::IndexMap;

use super::PipelineNode;
use super::PluginNode;

#[derive(Debug, Clone, PartialEq)]
pub struct PipelineMap(pub IndexMap<String, Vec<PipelineNode>>, pub u64);

impl<'de> serde::Deserialize<'de> for PipelineMap {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let value: IndexMap<String, Vec<PipelineNode>> = serde::Deserialize::deserialize(deserializer)?;
    let mut hasher = DefaultHasher::new();
    for (key, val) in &value {
      key.hash(&mut hasher);
      val.hash(&mut hasher);
    }
    Ok(PipelineMap(value, hasher.finish()))
  }
}

impl Hash for PipelineMap {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.1.hash(state);
  }
}

impl PipelineMap {
  pub fn get<P: AsRef<str>>(
    &self,
    path: &Path,
    pipeline: &Option<P>,
    _allow_empty: bool,
  ) -> Vec<PluginNode> {
    let basename = path.file_name().unwrap().to_str().unwrap();
    let path = path.as_os_str().to_str().unwrap();

    let mut matches = Vec::new();
    if let Some(pipeline) = pipeline {
      let exact_match = self
        .0
        .iter()
        .find(|(pattern, _)| is_match(pattern, path, basename, pipeline.as_ref()));
      if let Some((_, m)) = exact_match {
        matches.push(m);
      } else {
        return Vec::new();
      }
    }

    for (pattern, pipeline) in self.0.iter() {
      if is_match(pattern, path, basename, "") {
        matches.push(pipeline);
      }
    }

    if matches.is_empty() {
      return Vec::new();
    }

    fn flatten(matches: &mut Vec<&Vec<PipelineNode>>) -> Vec<PluginNode> {
      if matches.is_empty() {
        return Vec::new();
      }

      matches
        .remove(0)
        .into_iter()
        .flat_map(|node| {
          match node {
            PipelineNode::Plugin(plugin) => vec![plugin.clone()],
            PipelineNode::Spread => {
              // TODO: error if more than one spread
              flatten(matches)
            }
          }
        })
        .collect()
    }

    flatten(&mut matches)
  }

  pub fn named_pipelines(&self) -> Vec<&str> {
    self
      .0
      .keys()
      .filter_map(|glob| glob.split_once(':').map(|g| g.0))
      .collect()
  }
}

fn is_match(pattern: &str, path: &str, basename: &str, pipeline: &str) -> bool {
  let (pattern_pipeline, glob) = pattern.split_once(':').unwrap_or(("", pattern));
  pipeline == pattern_pipeline && (glob_match(glob, basename) || glob_match(glob, path))
}
