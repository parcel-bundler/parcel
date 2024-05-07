use indexmap::indexmap;
use indexmap::IndexMap;

use super::PipelineMap;
use super::PipelineNode;
use super::PluginNode;

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
