use glob_match::glob_match;
use indexmap::IndexMap;
use std::{
  path::{Path, PathBuf},
  sync::Arc,
};

use crate::{
  bundler::{Bundler, DefaultBundler},
  namer::Namer,
  optimizer::Optimizer,
  packager::Packager,
  resolver::Resolver,
  transformer::Transformer,
};

pub struct ParcelConfig {
  pub resolvers: Vec<Plugin<dyn Resolver>>,
  pub transformers: PipelineMap<dyn Transformer>,
  pub bundler: Plugin<dyn Bundler>,
  pub namers: Vec<Plugin<dyn Namer>>,
  pub runtimes: Vec<Plugin<()>>,
  pub packagers: IndexMap<String, Plugin<dyn Packager>>,
  pub optimizers: PipelineMap<dyn Optimizer>,
  pub compressors: PipelineMap<()>,
  pub reporters: Vec<Plugin<()>>,
  pub validators: PipelineMap<()>,
}

impl Default for ParcelConfig {
  fn default() -> Self {
    ParcelConfig {
      resolvers: Default::default(),
      transformers: Default::default(),
      bundler: Plugin {
        package_name: "@parcel/bundler-default".into(),
        key_path: Some("/bundler".into()),
        plugin: Arc::new(DefaultBundler {}),
      },
      namers: Default::default(),
      runtimes: Default::default(),
      packagers: Default::default(),
      optimizers: Default::default(),
      validators: Default::default(),
      compressors: Default::default(),
      reporters: Default::default(),
    }
  }
}

pub struct PipelineMap<T: ?Sized>(pub IndexMap<String, Vec<PipelineNode<T>>>);

impl<T: ?Sized> Default for PipelineMap<T> {
  fn default() -> Self {
    PipelineMap(IndexMap::new())
  }
}

#[derive(Default)]
pub struct Plugin<T: ?Sized> {
  pub package_name: String,
  pub key_path: Option<String>,
  pub plugin: Arc<T>,
}

impl<T: ?Sized> Clone for Plugin<T> {
  fn clone(&self) -> Self {
    Plugin {
      package_name: self.package_name.clone(),
      key_path: self.key_path.clone(),
      plugin: self.plugin.clone(),
    }
  }
}

impl<T: ?Sized> PartialEq for Plugin<T> {
  fn eq(&self, other: &Self) -> bool {
    self.package_name == other.package_name
  }
}

pub struct JsPlugin {
  pub package_name: String,
  pub resolve_from: PathBuf,
}

impl<T> std::fmt::Debug for Plugin<T> {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    self.package_name.fmt(f)
  }
}

#[derive(Clone)]
pub enum PipelineNode<T: ?Sized> {
  Plugin(Plugin<T>),
  Spread,
}

impl<T: ?Sized> PipelineMap<T> {
  pub fn get<P: AsRef<str>>(
    &self,
    path: &str,
    pipeline: &Option<P>,
    _allow_empty: bool,
  ) -> Vec<Plugin<T>> {
    let basename = Path::new(path).file_name().unwrap().to_str().unwrap();

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

    fn flatten<T: ?Sized>(matches: &mut Vec<&Vec<PipelineNode<T>>>) -> Vec<Plugin<T>> {
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

// impl Default for ParcelConfig {
//   fn default() -> Self {
//     ParcelConfig {
//       transformers: PipelineMap(indexmap! {
//         "*.{js,mjs,jsm,jsx,es6,ts,tsx}".into() => vec![PipelineNode::Plugin(PluginNode {
//           package_name: "@parcel/transformer-js".into(),
//           resolve_from: "/".into(),
//           key_path: None
//         })],
//       }),
//       resolvers: vec![],
//       bundler: PluginNode {
//         package_name: "@parcel/bundler-default".into(),
//         resolve_from: "/".into(),
//         key_path: None,
//       },
//       namers: vec![],
//       runtimes: vec![],
//       optimizers: PipelineMap(indexmap! {}),
//       packagers: indexmap! {},
//       validators: PipelineMap(indexmap! {}),
//       compressors: PipelineMap(indexmap! {}),
//       reporters: vec![],
//     }
//   }
// }

// #[derive(Deserialize)]
// struct RawParcelConfig {
//   extends: Option<ParcelConfigExtends>,
//   resolvers: Option<RawPipeline>,
//   transformers: Option<RawPipelineMap>,
//   bundler: Option<String>,
//   namers: Option<RawPipeline>,
//   runtimes: Option<RawPipeline>,
//   packagers: Option<IndexMap<String, String>>,
//   optimizers: Option<RawPipelineMap>,
//   compressors: Option<RawPipelineMap>,
//   reporters: Option<RawPipeline>,
//   validators: Option<RawPipelineMap>,
// }

// #[derive(Deserialize)]
// #[serde(untagged)]
// enum ParcelConfigExtends {
//   String(String),
//   Array(Vec<String>),
// }

// #[derive(Default, Deserialize)]
// #[serde(transparent)]
// struct RawPipeline(Vec<String>);

// #[derive(Default, Deserialize)]
// #[serde(transparent)]
// struct RawPipelineMap(IndexMap<String, RawPipeline>);

// impl RawParcelConfig {
//   fn resolve(self, file_path: PathBuf) -> ParcelConfig {
//     ParcelConfig {
//       resolvers: self
//         .resolvers
//         .unwrap_or_default()
//         .resolve(&file_path, "/resolvers"),
//       transformers: self
//         .transformers
//         .unwrap_or_default()
//         .resolve(&file_path, "/transformers"),
//       bundler: (),
//       namers: self
//         .namers
//         .unwrap_or_default()
//         .resolve(&file_path, "/namers"),
//       runtimes: self
//         .runtimes
//         .unwrap_or_default()
//         .resolve(&file_path, "/runtimes"),
//       packagers: self.packagers.unwrap_or_default(),
//       optimizers: self
//         .optimizers
//         .unwrap_or_default()
//         .resolve(&file_path, "/optimizers"),
//       validators: self
//         .validators
//         .unwrap_or_default()
//         .resolve(&file_path, "/validators"),
//       compressors: self
//         .compressors
//         .unwrap_or_default()
//         .resolve(&file_path, "/compressors"),
//       reporters: self
//         .reporters
//         .unwrap_or_default()
//         .resolve(&file_path, "/reporters"),
//     }
//   }
// }

// impl RawPipeline {
//   fn resolve(self, file_path: &Path, key_path: &str) -> Vec<PipelineNode> {
//     self
//       .0
//       .into_iter()
//       .enumerate()
//       .map(|(index, pkg)| {
//         if pkg == "..." {
//           PipelineNode::Spread
//         } else {
//           PipelineNode::Plugin(PluginNode {
//             package_name: pkg,
//             resolve_from: file_path.into(),
//             key_path: Some(format!("{}/{}", key_path, index)),
//           })
//         }
//       })
//       .collect()
//   }
// }

// impl RawPipelineMap {
//   fn resolve(self, file_path: &Path, key_path: &str) -> PipelineMap {
//     PipelineMap(
//       self
//         .0
//         .into_iter()
//         .map(|(key, pipeline)| {
//           // TODO: error on reserved named pipeline
//           let pipeline = pipeline.resolve(file_path, &format!("{}/{}", key_path, key));
//           (key, pipeline)
//         })
//         .collect(),
//     )
//   }
// }
