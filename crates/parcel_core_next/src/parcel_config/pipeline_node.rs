use std::hash::Hash;

use super::PluginNode;

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
