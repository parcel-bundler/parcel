use std::collections::HashMap;
use std::collections::HashSet;

use petgraph::graph::DiGraph;

use crate::cache::Cache;
use crate::environment::EnvironmentFlags;
use crate::parcel_config::PipelineMap;
use crate::parcel_config::PluginNode;
use crate::request_tracker::Request;
use crate::request_tracker::RequestTracker;
use crate::requests::asset_request::AssetRequest;
use crate::requests::entry_request::EntryRequest;
use crate::requests::path_request::PathRequest;
use crate::requests::path_request::ResolverResult;
use crate::requests::target_request::TargetRequest;
use crate::types::Asset;
use crate::types::Dependency;
use crate::types::DependencyFlags;
use crate::types::Symbol;
use crate::types::SymbolFlags;

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
          if dep.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
            dep.flags |= DependencyFlags::HAS_SYMBOLS;
            dep.symbols.push(Symbol {
              exported: "*".into(),
              local: "*".into(),
              flags: SymbolFlags::IS_WEAK,
              loc: None,
            });
          }

          let dep_node = graph
            .graph
            .add_node(AssetGraphNode::Dependency(dep.clone()));
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
        let asset_request = match result.unwrap() {
          ResolverResult::Resolved {
            path,
            code,
            pipeline,
            side_effects,
          } => AssetRequest {
            transformers: &self.transformers,
            file_path: path,
            code,
            pipeline,
            side_effects,
            env: match graph.graph.node_weight(*node).unwrap() {
              AssetGraphNode::Dependency(dep) => dep.env.clone(),
              _ => unreachable!(),
            },
          },
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
        let asset_node = graph.graph.add_node(AssetGraphNode::Asset(res.asset));
        asset_request_to_asset.insert(asset_request_id, asset_node);
        graph
          .graph
          .add_edge(dep_node, asset_node, AssetGraphEdge {});

        for dep in res.dependencies {
          let dep_node = graph
            .graph
            .add_node(AssetGraphNode::Dependency(dep.clone()));
          dep_nodes.push(dep_node);
          graph
            .graph
            .add_edge(asset_node, dep_node, AssetGraphEdge {});
          path_requests.push(PathRequest {
            dep,
            resolvers: &self.resolvers,
            named_pipelines: &named_pipelines,
          });
        }
      }

      for (req_id, dep_node) in already_visited_requests {
        graph
          .graph
          .add_edge(dep_node, asset_request_to_asset[&req_id], AssetGraphEdge {});
      }
    }

    graph
  }
}
