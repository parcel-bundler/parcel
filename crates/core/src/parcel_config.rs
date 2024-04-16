use glob_match::glob_match;
use indexmap::{indexmap, IndexMap};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct ParcelConfig {
  resolvers: Vec<PluginNode>,
  transformers: IndexMap<String, Vec<PipelineNode>>,
  bundler: PluginNode,
  namers: Vec<PluginNode>,
  runtimes: Vec<PluginNode>,
  packagers: IndexMap<String, Vec<PluginNode>>,
  optimizers: IndexMap<String, Vec<PluginNode>>,
  validators: IndexMap<String, Vec<PluginNode>>,
  compressors: IndexMap<String, Vec<PluginNode>>,
  reporters: Vec<PluginNode>,
}

#[derive(Clone, Debug)]
pub struct PluginNode {
  pub package_name: String,
  pub resolve_from: PathBuf,
  pub key_path: Option<String>,
}

#[derive(Debug)]
pub enum PipelineNode {
  Plugin(PluginNode),
  Spread,
}

impl ParcelConfig {
  pub fn transformers<P: AsRef<str>>(
    &self,
    path: &Path,
    pipeline: &Option<P>,
    allow_empty: bool,
  ) -> Vec<PluginNode> {
    let basename = path.file_name().unwrap().to_str().unwrap();
    let path = path.as_os_str().to_str().unwrap();

    let mut matches = Vec::new();
    if let Some(pipeline) = pipeline {
      let exact_match = self
        .transformers
        .iter()
        .find(|(pattern, _)| is_match(pattern, path, basename, pipeline.as_ref()));
      if let Some((_, m)) = exact_match {
        matches.push(m);
      } else {
        return Vec::new();
      }
    }

    for (pattern, pipeline) in self.transformers.iter() {
      if is_match(pattern, path, basename, "") {
        matches.push(pipeline);
      }
    }

    if matches.is_empty() {
      return Vec::new();
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

fn is_match(pattern: &str, path: &str, basename: &str, pipeline: &str) -> bool {
  let (pattern_pipeline, glob) = pattern.split_once(':').unwrap_or(("", pattern));
  pipeline == pattern_pipeline && (glob_match(glob, basename) || glob_match(glob, path))
}

impl Default for ParcelConfig {
  fn default() -> Self {
    ParcelConfig {
      transformers: indexmap! {
        "*.{js,mjs,jsm,jsx,es6,ts,tsx}".into() => vec![PipelineNode::Plugin(PluginNode {
          package_name: "@parcel/transformer-js".into(),
          resolve_from: "/".into(),
          key_path: None
        })],
      },
      resolvers: vec![],
      bundler: PluginNode {
        package_name: "@parcel/bundler-default".into(),
        resolve_from: "/".into(),
        key_path: None,
      },
      namers: vec![],
      runtimes: vec![],
      optimizers: indexmap! {},
      packagers: indexmap! {},
      validators: indexmap! {},
      compressors: indexmap! {},
      reporters: vec![],
    }
  }
}
