use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;
use std::path::PathBuf;

use glob_match::glob_match;
use indexmap::indexmap;
use indexmap::IndexMap;

#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct ParcelConfig {
  pub resolvers: Vec<PluginNode>,
  pub transformers: PipelineMap,
  pub bundler: PluginNode,
  pub namers: Vec<PluginNode>,
  pub runtimes: Vec<PluginNode>,
  pub packagers: IndexMap<String, PluginNode>,
  pub optimizers: PipelineMap,
  pub validators: PipelineMap,
  pub compressors: PipelineMap,
  pub reporters: Vec<PluginNode>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PipelineMap(IndexMap<String, Vec<PipelineNode>>, u64);

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

#[derive(Clone, Debug, Hash, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginNode {
  pub package_name: String,
  pub resolve_from: PathBuf,
  pub key_path: Option<String>,
}

#[derive(Clone, Debug, Hash, PartialEq)]
pub enum PipelineNode {
  Plugin(PluginNode),
  Spread,
}

impl<'de> serde::Deserialize<'de> for PipelineNode {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    if let Ok(node) = PluginNode::deserialize(deserializer) {
      return Ok(PipelineNode::Plugin(node));
    }
    Ok(PipelineNode::Spread)
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

impl Default for ParcelConfig {
  fn default() -> Self {
    ParcelConfig {
      transformers: PipelineMap(
        indexmap! {
          "*.{js,mjs,jsm,jsx,es6,ts,tsx}".into() => vec![PipelineNode::Plugin(PluginNode {
            package_name: "@parcel/transformer-js".into(),
            resolve_from: "/".into(),
            key_path: None
          })],
        },
        0,
      ),
      resolvers: vec![],
      bundler: PluginNode {
        package_name: "@parcel/bundler-default".into(),
        resolve_from: "/".into(),
        key_path: None,
      },
      namers: vec![],
      runtimes: vec![],
      optimizers: PipelineMap(indexmap! {}, 0),
      packagers: indexmap! {},
      validators: PipelineMap(indexmap! {}, 0),
      compressors: PipelineMap(indexmap! {}, 0),
      reporters: vec![],
    }
  }
}
