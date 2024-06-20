use std::collections::HashSet;

use petgraph::graph::{DiGraph, NodeIndex};

use crate::types::{Asset, Dependency};

#[derive(Debug, Clone)]
pub struct AssetGraph {
  graph: DiGraph<AssetGraphNode, AssetGraphEdge>,
  assets: Vec<AssetNode>,
  dependencies: Vec<DependencyNode>,
}

#[derive(Debug, Clone)]
struct AssetNode {
  asset: Asset,
}

#[derive(Debug, Clone)]
struct DependencyNode {
  dependency: Dependency,
  requested_symbols: HashSet<String>,
  state: DependencyState,
}

#[derive(Debug, Clone)]
pub enum AssetGraphNode {
  Root,
  Entry,
  Asset(usize),
  Dependency(usize),
}

#[derive(Debug, Clone)]
pub struct AssetGraphEdge {}

#[derive(Debug, Clone, PartialEq)]
enum DependencyState {
  New,
  Deferred,
  Excluded,
  Resolved,
}

impl AssetGraph {
  pub fn new() -> Self {
    AssetGraph {
      graph: DiGraph::new(),
      assets: Vec::new(),
      dependencies: Vec::new(),
    }
  }

  pub fn add_dependency(
    &mut self,
    dep: Dependency,
    requested_symbols: HashSet<String>,
  ) -> NodeIndex {
    let idx = self.dependencies.len();
    self.dependencies.push(DependencyNode {
      dependency: dep,
      requested_symbols,
      state: DependencyState::New,
    });
    self.graph.add_node(AssetGraphNode::Dependency(idx))
  }

  pub fn add_asset(&mut self, asset: Asset) -> NodeIndex {
    let idx = self.assets.len();
    self.assets.push(AssetNode { asset });
    self.graph.add_node(AssetGraphNode::Asset(idx))
  }

  pub fn dependency_index(&self, node_index: NodeIndex) -> Option<usize> {
    match self.graph.node_weight(node_index).unwrap() {
      AssetGraphNode::Dependency(idx) => Some(*idx),
      _ => None,
    }
  }

  pub fn asset_index(&self, node_index: NodeIndex) -> Option<usize> {
    match self.graph.node_weight(node_index).unwrap() {
      AssetGraphNode::Asset(idx) => Some(*idx),
      _ => None,
    }
  }
}

impl serde::Serialize for AssetGraph {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    let nodes: Vec<_> = self
      .graph
      .node_weights()
      .map(|node| match node {
        AssetGraphNode::Root => SerializedAssetGraphNode::Root,
        AssetGraphNode::Entry => SerializedAssetGraphNode::Entry,
        AssetGraphNode::Asset(idx) => SerializedAssetGraphNode::Asset {
          value: &self.assets[*idx].asset,
        },
        AssetGraphNode::Dependency(idx) => SerializedAssetGraphNode::Dependency {
          value: &self.dependencies[*idx].dependency,
          has_deferred: self.dependencies[*idx].state == DependencyState::Deferred,
        },
      })
      .collect();
    let raw_edges = self.graph.raw_edges();
    let mut edges = Vec::with_capacity(raw_edges.len() * 2);
    for edge in raw_edges {
      edges.push(edge.source().index() as u32);
      edges.push(edge.target().index() as u32);
    }

    #[derive(serde::Serialize)]
    #[serde(tag = "type", rename_all = "lowercase")]
    enum SerializedAssetGraphNode<'a> {
      Root,
      Entry,
      Asset {
        value: &'a Asset,
      },
      Dependency {
        value: &'a Dependency,
        has_deferred: bool,
      },
    }

    #[derive(serde::Serialize)]
    struct SerializedAssetGraph<'a> {
      nodes: Vec<SerializedAssetGraphNode<'a>>,
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
      std::mem::discriminant(node).hash(state);
      match node {
        AssetGraphNode::Asset(idx) => self.assets[*idx].asset.id().hash(state),
        AssetGraphNode::Dependency(idx) => self.dependencies[*idx].dependency.id().hash(state),
        _ => {}
      }
    }
  }
}
