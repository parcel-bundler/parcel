use petgraph::graph::DiGraph;

use crate::types::Asset;
use crate::types::Dependency;

#[derive(Debug, Clone)]
pub struct AssetGraph {
  pub graph: DiGraph<AssetGraphNode, AssetGraphEdge>,
}

impl AssetGraph {
  pub fn new() -> Self {
    AssetGraph {
      graph: DiGraph::new(),
    }
  }
}

impl serde::Serialize for AssetGraph {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    let nodes: Vec<_> = self.graph.node_weights().collect();
    let raw_edges = self.graph.raw_edges();
    let mut edges = Vec::with_capacity(raw_edges.len() * 2);
    for edge in raw_edges {
      edges.push(edge.source().index() as u32);
      edges.push(edge.target().index() as u32);
    }

    #[derive(serde::Serialize)]
    struct SerializedAssetGraph<'a> {
      nodes: Vec<&'a AssetGraphNode>,
      // TODO: somehow make this a typed array?
      edges: Vec<u32>,
    }

    let serialized = SerializedAssetGraph { nodes, edges };
    serialized.serialize(serializer)
  }
}

impl std::hash::Hash for AssetGraph {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    for node in self.graph.node_weights() {
      node.hash(state)
    }
  }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum AssetGraphNode {
  Root,
  Asset(Asset),
  Dependency(Dependency),
}

impl std::hash::Hash for AssetGraphNode {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    std::mem::discriminant(self).hash(state);
    match self {
      AssetGraphNode::Root => {}
      AssetGraphNode::Asset(asset) => asset.id().hash(state),
      AssetGraphNode::Dependency(dep) => dep.id().hash(state),
    }
  }
}

#[derive(Debug, Clone)]
pub struct AssetGraphEdge {}
