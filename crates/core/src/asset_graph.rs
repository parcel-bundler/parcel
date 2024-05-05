use std::collections::{HashMap, HashSet};

use petgraph::{
  graph::{DiGraph, NodeIndex},
  visit::EdgeRef,
  Direction,
};

use crate::{
  cache::Cache,
  environment::EnvironmentFlags,
  parcel_config::{PipelineMap, PluginNode},
  request_tracker::{Request, RequestTracker},
  requests::{
    asset_request::AssetRequest,
    entry_request::EntryRequest,
    path_request::{PathRequest, ResolverResult},
    target_request::TargetRequest,
  },
  types::{Asset, AssetFlags, Dependency, DependencyFlags, Symbol, SymbolFlags},
};

#[derive(Debug, Clone)]
pub struct AssetGraph {
  graph: DiGraph<AssetGraphNode, AssetGraphEdge>,
  assets: Vec<AssetNode>,
  dependencies: Vec<DependencyNode>,
}

#[derive(Debug, Clone)]
struct AssetNode {
  asset: Asset,
  requested_symbols: HashSet<String>,
}

#[derive(Debug, Clone)]
struct DependencyNode {
  dependency: Dependency,
  requested_symbols: HashSet<String>,
  deferred: bool,
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
    let deferred = !dep.flags.contains(DependencyFlags::ENTRY);
    self.dependencies.push(DependencyNode {
      dependency: dep,
      requested_symbols,
      deferred,
    });
    self.graph.add_node(AssetGraphNode::Dependency(idx))
  }

  pub fn add_asset(&mut self, asset: Asset) -> NodeIndex {
    let idx = self.assets.len();
    self.assets.push(AssetNode {
      asset,
      requested_symbols: HashSet::new(),
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
        AssetGraphNode::Asset(idx) => SerializedAssetGraphNode::Asset {
          value: &self.assets[*idx].asset,
        },
        AssetGraphNode::Dependency(idx) => SerializedAssetGraphNode::Dependency {
          value: &self.dependencies[*idx].dependency,
          has_deferred: self.dependencies[*idx].deferred,
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
        AssetGraphNode::Root => {}
        AssetGraphNode::Asset(idx) => self.assets[*idx].asset.id().hash(state),
        AssetGraphNode::Dependency(idx) => self.dependencies[*idx].dependency.id().hash(state),
      }
    }
  }
}

#[derive(Debug, Clone)]
pub enum AssetGraphNode {
  Root,
  Asset(usize),
  Dependency(usize),
}

#[derive(Debug, Clone)]
pub struct AssetGraphEdge {}

impl AssetGraph {
  pub fn propagate_requested_symbols(
    &mut self,
    asset_node: NodeIndex,
    requested_symbols: HashSet<String>,
  ) -> Vec<NodeIndex> {
    let asset_index = self.asset_index(asset_node).unwrap();
    let AssetNode {
      asset,
      requested_symbols: asset_requested_symbols,
    } = &mut self.assets[asset_index];

    let mut re_exports = HashSet::new();
    let mut wildcards = HashSet::new();

    if requested_symbols.contains("*") {
      for sym in &asset.symbols {
        if asset_requested_symbols.insert(sym.exported.clone()) {
          if sym.flags.contains(SymbolFlags::IS_WEAK) {
            re_exports.insert(sym.local.clone());
          }
        }
      }

      wildcards.insert("*");
    } else {
      for sym in requested_symbols.iter() {
        if asset_requested_symbols.insert(sym.clone()) {
          if let Some(asset_symbol) = asset.symbols.iter().find(|s| s.exported == *sym) {
            if asset_symbol.flags.contains(SymbolFlags::IS_WEAK) {
              re_exports.insert(asset_symbol.local.clone());
            }
          } else {
            wildcards.insert(sym.as_str());
          }
        }
      }
    }

    let side_effects = asset.flags.contains(AssetFlags::SIDE_EFFECTS);

    let mut undeferred_deps = Vec::new();
    let deps: Vec<_> = self
      .graph
      .neighbors_directed(asset_node, Direction::Outgoing)
      .collect();
    for dep_node in deps {
      let dep_index = self.dependency_index(dep_node).unwrap();
      let DependencyNode {
        dependency,
        requested_symbols,
        deferred,
      } = &mut self.dependencies[dep_index];

      let mut updated = false;
      for sym in &dependency.symbols {
        if sym.flags.contains(SymbolFlags::IS_WEAK) && re_exports.contains(&sym.local) {
          if requested_symbols.insert(sym.exported.clone()) {
            updated = true;
          }
        } else if sym.flags.contains(SymbolFlags::IS_WEAK) && sym.local == "*" {
          for wildcard in &wildcards {
            if requested_symbols.insert(wildcard.to_string()) {
              updated = true;
            }
          }
        } else if !sym.flags.contains(SymbolFlags::IS_WEAK) {
          if requested_symbols.insert(sym.exported.clone()) {
            updated = true;
          }
        }
      }

      if updated || side_effects || !dependency.flags.contains(DependencyFlags::HAS_SYMBOLS) {
        if let Some(resolved) = self
          .graph
          .edges_directed(dep_node, Direction::Outgoing)
          .next()
        {
          if updated {
            let requested_symbols = requested_symbols.clone();
            let d = self.propagate_requested_symbols(resolved.target(), requested_symbols);
            undeferred_deps.extend(d);
          }
        } else {
          *deferred = false;
          undeferred_deps.push(dep_node);
        }
      }
    }

    undeferred_deps
  }
}

pub struct AssetGraphRequest<'a> {
  pub entries: Vec<String>,
  pub transformers: &'a PipelineMap,
  pub resolvers: &'a Vec<PluginNode>,
}

impl<'a> AssetGraphRequest<'a> {
  pub fn build(&mut self, request_tracker: &mut RequestTracker, cache: &Cache) -> AssetGraph {
    let mut graph = AssetGraph::new();
    let root = graph.graph.add_node(AssetGraphNode::Root);

    let entry_requests = self
      .entries
      .iter()
      .map(|entry| EntryRequest {
        entry: entry.clone(),
      })
      .collect();

    let entries = request_tracker.run_requests(entry_requests);

    let target_requests = entries
      .iter()
      .flat_map(|entries| {
        entries.as_ref().unwrap().iter().map(|entry| TargetRequest {
          entry: entry.clone(),
        })
      })
      .collect();
    let targets = request_tracker.run_requests(target_requests);

    let named_pipelines = self.transformers.named_pipelines();

    let mut path_requests = Vec::new();
    let mut dep_nodes = Vec::new();
    let mut target_iter = targets.into_iter();
    for entry_result in entries {
      for entry in entry_result.unwrap() {
        let targets = target_iter.next().unwrap().unwrap();
        for target in targets {
          let mut dep = Dependency::new(entry.file_path.clone(), target.env.clone());
          dep.target = Some(Box::new(target));
          dep.flags |= DependencyFlags::ENTRY | DependencyFlags::NEEDS_STABLE_NAME;
          let mut requested_symbols = HashSet::new();
          if dep.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
            dep.flags |= DependencyFlags::HAS_SYMBOLS;
            dep.symbols.push(Symbol {
              exported: "*".into(),
              local: "*".into(),
              flags: SymbolFlags::IS_WEAK,
              loc: None,
            });
            requested_symbols.insert("*".into());
          }

          let dep_node = graph.add_dependency(dep.clone(), requested_symbols);
          dep_nodes.push(dep_node);
          graph.graph.add_edge(root, dep_node, AssetGraphEdge {});
          path_requests.push(PathRequest {
            dep,
            resolvers: &self.resolvers,
            named_pipelines: &named_pipelines,
          });
        }
      }
    }

    let mut visited = HashSet::new();
    let mut asset_request_to_asset = HashMap::new();

    while !path_requests.is_empty() {
      let resolved = request_tracker.run_requests(path_requests);

      let mut asset_requests_to_run = Vec::new();
      let mut dep_nodes_to_run = Vec::new();
      let mut already_visited_requests = Vec::new();
      for (result, node) in resolved.into_iter().zip(dep_nodes.iter()) {
        let DependencyNode {
          dependency,
          requested_symbols,
          ..
        } = &graph.dependencies[graph.dependency_index(*node).unwrap()];
        let asset_request = match result.unwrap() {
          ResolverResult::Resolved {
            path,
            code,
            pipeline,
            side_effects,
          } => {
            if !side_effects
              && requested_symbols.is_empty()
              && dependency.flags.contains(DependencyFlags::HAS_SYMBOLS)
            {
              continue;
            }

            AssetRequest {
              transformers: &self.transformers,
              file_path: path,
              code,
              pipeline,
              side_effects,
              env: dependency.env.clone(),
            }
          }
          ResolverResult::Excluded => continue,
          _ => todo!(),
        };

        let id = asset_request.id();
        if visited.insert(id) {
          asset_requests_to_run.push(asset_request);
          dep_nodes_to_run.push((id, *node));
        } else {
          already_visited_requests.push((id, *node));
        }
      }

      let results = request_tracker.run_requests(asset_requests_to_run);
      // println!("deps {:?}", deps);

      path_requests = Vec::new();
      dep_nodes = Vec::new();
      for (result, (asset_request_id, dep_node)) in results.into_iter().zip(dep_nodes_to_run) {
        let res = result.unwrap();
        cache.set(res.asset.content_key.clone(), res.code);

        let DependencyNode {
          requested_symbols, ..
        } = &graph.dependencies[graph.dependency_index(dep_node).unwrap()];
        let requested_symbols = requested_symbols.clone();

        let asset_node = graph.add_asset(res.asset);

        asset_request_to_asset.insert(asset_request_id, asset_node);
        graph
          .graph
          .add_edge(dep_node, asset_node, AssetGraphEdge {});

        for dep in res.dependencies {
          let dep_node = graph.add_dependency(dep, HashSet::new());
          graph
            .graph
            .add_edge(asset_node, dep_node, AssetGraphEdge {});
        }

        let undefered_deps = graph.propagate_requested_symbols(asset_node, requested_symbols);
        for dep_node in undefered_deps {
          dep_nodes.push(dep_node);
          path_requests.push(PathRequest {
            dep: graph.dependencies[graph.dependency_index(dep_node).unwrap()]
              .dependency
              .clone(),
            resolvers: &self.resolvers,
            named_pipelines: &named_pipelines,
          });
        }
      }

      for (req_id, dep_node) in already_visited_requests {
        let asset_node = asset_request_to_asset[&req_id];
        graph
          .graph
          .add_edge(dep_node, asset_node, AssetGraphEdge {});

        let DependencyNode {
          requested_symbols, ..
        } = &graph.dependencies[graph.dependency_index(dep_node).unwrap()];
        let undefered_deps =
          graph.propagate_requested_symbols(asset_node, requested_symbols.clone());
        for dep_node in undefered_deps {
          dep_nodes.push(dep_node);
          path_requests.push(PathRequest {
            dep: graph.dependencies[graph.dependency_index(dep_node).unwrap()]
              .dependency
              .clone(),
            resolvers: &self.resolvers,
            named_pipelines: &named_pipelines,
          });
        }
      }
    }

    graph
  }
}
