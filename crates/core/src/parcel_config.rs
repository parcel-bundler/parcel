use glob_match::glob_match;
use indexmap::IndexMap;
use std::path::PathBuf;

pub struct ParcelConfig {
  resolvers: Vec<PluginNode>,
  transformers: IndexMap<String, Vec<PipelineNode>>,
  bundler: PluginNode,
  namers: Vec<PluginNode>,
  runtimes: Vec<PluginNode>,
  packagers: IndexMap<String, Vec<PluginNode>>,
  validators: IndexMap<String, Vec<PluginNode>>,
  compressors: IndexMap<String, Vec<PluginNode>>,
  reporters: Vec<PluginNode>,
}

#[derive(Clone)]
pub struct PluginNode {
  pub package_name: String,
  pub resolver_from: PathBuf,
  pub key_path: Option<String>,
}

pub enum PipelineNode {
  Plugin(PluginNode),
  Spread,
}

impl ParcelConfig {
  pub fn transformers(
    &self,
    path: &str,
    pipeline: Option<&str>,
    allow_empty: bool,
  ) -> Vec<PluginNode> {
    let mut matches = Vec::new();
    if let Some(pipeline) = pipeline {
      let exact_match = self
        .transformers
        .iter()
        .find(|(pattern, _)| is_match(pattern, path, pipeline));
      if let Some((_, m)) = exact_match {
        matches.push(m);
      } else {
        return Vec::new();
      }
    }

    for (pattern, pipeline) in self.transformers.iter() {
      if is_match(pattern, path, "") {
        matches.push(pipeline);
      }
    }

    fn flatten(matches: &mut Vec<&Vec<PipelineNode>>) -> Vec<PluginNode> {
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
}

fn is_match(pattern: &str, path: &str, pipeline: &str) -> bool {
  let (pattern_pipeline, glob) = pattern.split_once(':').unwrap_or(("", pattern));

  pipeline == pattern_pipeline && glob_match(glob, path)
}
