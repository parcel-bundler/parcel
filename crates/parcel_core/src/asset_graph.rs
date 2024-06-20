use std::{collections::HashSet, sync::Arc};

use petgraph::{
  graph::{DiGraph, NodeIndex},
  visit::EdgeRef,
  Direction,
};

use crate::types::{Asset, Dependency};

#[derive(Debug, Clone)]
pub struct AssetGraph {
  pub graph: DiGraph<AssetGraphNode, AssetGraphEdge>,
  pub assets: Vec<AssetNode>,
  pub dependencies: Vec<DependencyNode>,
}

#[derive(Debug, Clone)]
pub struct AssetNode {
  pub asset: Asset,
  pub requested_symbols: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct DependencyNode {
  pub dependency: Arc<Dependency>,
  pub requested_symbols: HashSet<String>,
  pub state: DependencyState,
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
pub enum DependencyState {
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
      dependency: Arc::new(dep),
      requested_symbols,
      state: DependencyState::New,
    });
    self.graph.add_node(AssetGraphNode::Dependency(idx))
  }

  pub fn add_asset(&mut self, asset: Asset) -> NodeIndex {
    let idx = self.assets.len();
    self.assets.push(AssetNode {
      asset,
      requested_symbols: HashSet::default(),
    });
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

  /// Propagates the requested symbols from an incoming dependency to an asset,
  /// and forwards those symbols to re-exported dependencies if needed.
  /// This may result in assets becoming un-deferred and transformed if they
  /// now have requested symbols.
  pub fn propagate_requested_symbols<F: FnMut(NodeIndex, Arc<Dependency>)>(
    &mut self,
    asset_node: NodeIndex,
    incoming_dep_node: NodeIndex,
    on_undeferred: &mut F,
  ) {
    let DependencyNode {
      requested_symbols, ..
    } = &self.dependencies[self.dependency_index(incoming_dep_node).unwrap()];

    let asset_index = self.asset_index(asset_node).unwrap();
    let AssetNode {
      asset,
      requested_symbols: asset_requested_symbols,
    } = &mut self.assets[asset_index];

    let mut re_exports = HashSet::<String>::default();
    let mut wildcards = HashSet::<String>::default();
    let star = String::from("*");

    if requested_symbols.contains(&star) {
      // If the requested symbols includes the "*" namespace,
      // we need to include all of the asset's exported symbols.
      for sym in &asset.symbols {
        if asset_requested_symbols.insert(sym.exported.clone()) && sym.is_weak {
          // Propagate re-exported symbol to dependency.
          re_exports.insert(sym.local.clone());
        }
      }

      // Propagate to all export * wildcard dependencies.
      wildcards.insert(star);
    } else {
      // Otherwise, add each of the requested symbols to the asset.
      for sym in requested_symbols.iter() {
        if asset_requested_symbols.insert(sym.clone()) {
          if let Some(asset_symbol) = asset.symbols.iter().find(|s| s.exported == *sym) {
            if asset_symbol.is_weak {
              // Propagate re-exported symbol to dependency.
              re_exports.insert(asset_symbol.local.clone());
            }
          } else {
            // If symbol wasn't found in the asset or a named re-export.
            // This means the symbol is in one of the export * wildcards, but we don't know
            // which one yet, so we propagate it to _all_ wildcard dependencies.
            wildcards.insert(sym.clone());
          }
        }
      }
    }

    let deps: Vec<_> = self
      .graph
      .neighbors_directed(asset_node, Direction::Outgoing)
      .collect();
    for dep_node in deps {
      let dep_index = self.dependency_index(dep_node).unwrap();
      let DependencyNode {
        dependency,
        requested_symbols,
        state,
      } = &mut self.dependencies[dep_index];

      let mut updated = false;
      for sym in &dependency.symbols {
        if sym.is_weak {
          // This is a re-export. If it is a wildcard, add all unmatched symbols
          // to this dependency, otherwise attempt to match a named re-export.
          if sym.local == "*" {
            for wildcard in &wildcards {
              if requested_symbols.insert(wildcard.clone()) {
                updated = true;
              }
            }
          } else if re_exports.contains(&sym.local)
            && requested_symbols.insert(sym.exported.clone())
          {
            updated = true;
          }
        } else if requested_symbols.insert(sym.exported.clone()) {
          // This is a normal import. Add the requested symbol.
          updated = true;
        }
      }

      // If the dependency was updated, propagate to the target asset if there is one,
      // or un-defer this dependency so we transform the requested asset.
      // We must always resolve new dependencies to determine whether they have side effects.
      if updated || *state == DependencyState::New {
        if let Some(resolved) = self
          .graph
          .edges_directed(dep_node, Direction::Outgoing)
          .next()
        {
          self.propagate_requested_symbols(resolved.target(), dep_node, on_undeferred);
        } else {
          on_undeferred(dep_node, dependency);
        }
      }
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
