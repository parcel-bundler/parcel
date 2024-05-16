use std::collections::HashSet;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;

use petgraph::graph::NodeIndex;
use petgraph::stable_graph::StableDiGraph;
use serde::Serialize;
use serde::Serializer;

use parcel_core::types::Asset;
use parcel_core::types::Dependency;

#[derive(Clone, Debug)]
pub struct AssetGraph {
  asset_groups: Vec<AssetGroupNode>,
  assets: Vec<AssetNode>,
  dependencies: Vec<DependencyNode>,
  graph: StableDiGraph<AssetGraphNode, AssetGraphEdge>,
}

#[derive(Debug, Clone)]
pub struct AssetGraphEdge {}

#[derive(Debug, Clone)]
pub enum AssetGraphNode {
  Root,
  Entry(PathBuf),
  Asset(usize),
  AssetGroup(usize),
  Dependency(usize),
}

pub struct AssetGroup {}

#[derive(Clone, Debug)]
struct AssetGroupNode {}

#[derive(Clone, Debug)]
struct AssetNode {
  asset: Asset,
  requested_symbols: HashSet<String>,
}

#[derive(Clone, Debug)]
struct DependencyNode {
  dependency: Dependency,
  requested_symbols: HashSet<String>,
  state: DependencyState,
}

#[derive(Clone, Debug, PartialEq)]
enum DependencyState {
  New,
  Deferred,
  Excluded,
  Resolved,
}

impl AssetGraph {
  pub fn new() -> Self {
    let mut graph = StableDiGraph::default();

    graph.add_node(AssetGraphNode::Root);

    let asset_graph = AssetGraph {
      graph,
      assets: Vec::new(),
      asset_groups: Vec::new(),
      dependencies: Vec::new(),
    };

    asset_graph
  }

  pub fn add_asset(&mut self, from: NodeIndex, asset: Asset) -> NodeIndex {
    let idx = self.assets.len();

    self.assets.push(AssetNode {
      asset,
      requested_symbols: HashSet::default(),
    });

    let idx = self.graph.add_node(AssetGraphNode::Asset(idx));

    self.graph.add_edge(from, idx, AssetGraphEdge {});

    idx
  }

  pub fn add_asset_group(&mut self, from: NodeIndex, asset_group: AssetGroup) -> NodeIndex {
    let idx = self.asset_groups.len();

    self.asset_groups.push(AssetGroupNode {});

    let idx = self.graph.add_node(AssetGraphNode::AssetGroup(idx));

    self.graph.add_edge(from, idx, AssetGraphEdge {});

    idx
  }

  pub fn add_dependency(
    &mut self,
    from: NodeIndex,
    dependency: Dependency,
    requested_symbols: HashSet<String>,
  ) -> NodeIndex {
    let idx = self.dependencies.len();

    self.dependencies.push(DependencyNode {
      dependency,
      requested_symbols,
      state: DependencyState::New,
    });

    let idx = self.graph.add_node(AssetGraphNode::Dependency(idx));

    self.graph.add_edge(from, idx, AssetGraphEdge {});

    idx
  }

  // TODO Potentially remove this if we can directly store it as an asset via add_asset
  pub fn add_entry(&mut self, entry: PathBuf) -> NodeIndex {
    let idx = self.graph.add_node(AssetGraphNode::Entry(entry));

    self
      .graph
      .add_edge(NodeIndex::new(0), idx, AssetGraphEdge {});

    idx
  }

  // The idea here is that all entries should be direct neighbors of the root node
  pub fn entry_assets(&self) -> Vec<&Asset> {
    let mut assets = Vec::new();

    for neighbor in self.graph.neighbors(NodeIndex::new(0)) {
      let idx = self.asset_index(neighbor);
      if let Some(idx) = idx {
        assets.push(&self.assets[idx].asset);
      }
    }

    assets
  }

  pub fn incoming_dependencies(&self, asset: Asset) -> Vec<Dependency> {
    let dependencies = Vec::new();
    let _asset_node = self.assets.iter().find(|a| a.asset.id() == asset.id());

    dependencies
    // TODO Port this
    // let asset_groups = self.graph.edges_connecting(a, b)
    // let nodeId = this.getNodeIdByContentKey(asset.id);
    // let assetGroupIds = this.getNodeIdsConnectedTo(nodeId);
    // let dependencies = [];
    // for (let i = 0; i < assetGroupIds.length; i++) {
    //   let assetGroupId = assetGroupIds[i];

    //   // Sometimes assets are connected directly to dependencies
    //   // rather than through an asset group. This happens due to
    //   // inline dependencies on assets via uniqueKey. See resolveAsset.
    //   let node = this.getNode(assetGroupId);
    //   if (node?.type === 'dependency') {
    //     dependencies.push(node.value);
    //     continue;
    //   }

    //   let assetIds = this.getNodeIdsConnectedTo(assetGroupId);
    //   for (let j = 0; j < assetIds.length; j++) {
    //     let node = this.getNode(assetIds[j]);
    //     if (!node || node.type !== 'dependency') {
    //       continue;
    //     }

    //     dependencies.push(node.value);
    //   }
    // }
  }

  fn asset_index(&self, node_index: NodeIndex) -> Option<usize> {
    match self.graph.node_weight(node_index).unwrap() {
      AssetGraphNode::Asset(idx) => Some(*idx),
      _ => None,
    }
  }

  fn dependency_index(&self, node_index: NodeIndex) -> Option<usize> {
    match self.graph.node_weight(node_index).unwrap() {
      AssetGraphNode::Dependency(idx) => Some(*idx),
      _ => None,
    }
  }
}

impl Hash for AssetGraph {
  fn hash<H: Hasher>(&self, state: &mut H) {
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

impl Serialize for AssetGraph {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    let nodes: Vec<_> = self
      .graph
      .node_weights()
      .map(|node| match node {
        AssetGraphNode::Root => SerializedAssetGraphNode::Root,
        AssetGraphNode::Entry(_entry) => SerializedAssetGraphNode::Entry,
        AssetGraphNode::Asset(idx) => SerializedAssetGraphNode::Asset {
          value: &self.assets[*idx].asset,
        },
        AssetGraphNode::Dependency(idx) => SerializedAssetGraphNode::Dependency {
          value: &self.dependencies[*idx].dependency,
          has_deferred: self.dependencies[*idx].state == DependencyState::Deferred,
        },
        AssetGraphNode::AssetGroup(_) => todo!(),
      })
      .collect();

    let mut edges = Vec::with_capacity(self.graph.edge_count() * 2);

    for edge_index in self.graph.edge_indices() {
      // TODO
      // edges.push(edge.source().index() as u32);
      // edges.push(edge.target().index() as u32);
    }

    #[derive(Serialize)]
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

    #[derive(Serialize)]
    struct SerializedAssetGraph<'a> {
      nodes: Vec<SerializedAssetGraphNode<'a>>,
      // TODO: somehow make this a typed array?
      edges: Vec<u32>,
    }

    let serialized = SerializedAssetGraph { nodes, edges };
    serialized.serialize(serializer)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn initializes_root_node() {
    let asset_graph = AssetGraph::new();

    assert!(asset_graph.assets.is_empty());
    assert!(asset_graph.dependencies.is_empty());

    assert_eq!(
      asset_graph
        .graph
        .node_weights()
        .map(|n| format!("{:?}", n))
        .collect::<String>(),
      String::from("Root")
    );
  }

  #[test]
  fn test() {
    let mut asset_graph = AssetGraph::new();

    let a = asset_graph.add_entry(PathBuf::from("a.js"));

    let b = asset_graph.add_asset(
      a,
      Asset {
        file_path: PathBuf::from("b.js"),
        ..Asset::default()
      },
    );

    asset_graph.add_asset(
      b,
      Asset {
        file_path: PathBuf::from("c.js"),
        ..Asset::default()
      },
    );
    // asset_graph.graph.remove_edge(EdgeIndex::new(1));

    for neighbour in asset_graph.graph.neighbors(NodeIndex::new(0)) {
      println!("got a neighbour {:?}", neighbour);
    }

    for edge in asset_graph.graph.edges(NodeIndex::new(0)) {
      println!("got a edge 1 {:?}", edge);
    }

    for edge in asset_graph.graph.edge_indices() {
      println!("got a edge 2 {:?}", edge);
    }
  }
}
