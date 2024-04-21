use std::collections::HashSet;

use petgraph::graph::DiGraph;

use crate::{
  request_tracker::{Request, RequestTracker},
  requests::{
    asset_request::AssetRequest, entry_request::EntryRequest,
    parcel_config_request::ParcelConfigRequest, path_request::PathRequest,
    target_request::TargetRequest,
  },
  types::{
    Asset, Dependency, Engines, Environment, EnvironmentContext, EnvironmentFlags, OutputFormat,
    SourceType,
  },
};

pub struct AssetGraph {
  graph: DiGraph<AssetGraphNode, AssetGraphEdge>,
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

#[derive(Debug, serde::Serialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
enum AssetGraphNode {
  Root,
  Asset(Asset),
  Dependency(Dependency),
}

#[derive(Debug)]
struct AssetGraphEdge {}

pub struct AssetGraphRequest {
  pub entries: Vec<String>,
}

impl AssetGraphRequest {
  pub fn build(&mut self, request_tracker: &mut RequestTracker) -> AssetGraph {
    let config = request_tracker.run_request(ParcelConfigRequest {}).unwrap();

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
    println!("entries {:?}", entries);

    let target_requests = entries
      .iter()
      .flat_map(|entries| {
        entries.as_ref().unwrap().iter().map(|entry| TargetRequest {
          entry: entry.clone(),
        })
      })
      .collect();
    let targets = request_tracker.run_requests(target_requests);

    // let env = Environment {
    //   context: EnvironmentContext::Browser,
    //   output_format: OutputFormat::Esmodule,
    //   source_type: SourceType::Module,
    //   source_map: None,
    //   flags: EnvironmentFlags::empty(),
    //   loc: None,
    //   include_node_modules: IncludeNode,
    //   engines: Engines::from_browserslist("last 2 versions", OutputFormat::Esmodule),
    // };
    let mut path_requests = Vec::new();
    let mut dep_nodes = Vec::new();
    let mut target_iter = targets.into_iter();
    for entry_result in entries {
      for entry in entry_result.unwrap() {
        let targets = target_iter.next().unwrap().unwrap();
        for target in targets {
          let mut dep = Dependency::new(entry.file_path.clone(), target.env.clone());
          dep.target = Some(Box::new(target));
          let dep_node = graph
            .graph
            .add_node(AssetGraphNode::Dependency(dep.clone()));
          dep_nodes.push(dep_node);
          graph.graph.add_edge(root, dep_node, AssetGraphEdge {});
          path_requests.push(PathRequest { dep });
        }
      }
    }

    let resolved = request_tracker.run_requests(path_requests);
    println!("resolved {:?}", resolved);

    let mut asset_requests: Vec<_> = resolved
      .into_iter()
      .zip(dep_nodes.iter())
      .map(|(result, node)| AssetRequest {
        transformers: &config.transformers,
        file_path: result.unwrap(),
        env: match graph.graph.node_weight(*node).unwrap() {
          AssetGraphNode::Dependency(dep) => dep.env.clone(),
          _ => unreachable!(),
        },
      })
      .collect();

    let mut visited = HashSet::new();
    for req in &asset_requests {
      visited.insert(req.id());
    }

    while !asset_requests.is_empty() {
      let results = request_tracker.run_requests(asset_requests);
      // println!("deps {:?}", deps);

      let mut path_requests = Vec::new();
      let mut new_dep_nodes = Vec::new();
      for (result, dep_node) in results.into_iter().zip(dep_nodes) {
        let res = result.unwrap();
        let asset_node = graph.graph.add_node(AssetGraphNode::Asset(res.asset));
        graph
          .graph
          .add_edge(dep_node, asset_node, AssetGraphEdge {});

        for dep in res.dependencies {
          let dep_node = graph
            .graph
            .add_node(AssetGraphNode::Dependency(dep.clone()));
          new_dep_nodes.push(dep_node);
          graph
            .graph
            .add_edge(asset_node, dep_node, AssetGraphEdge {});
          path_requests.push(PathRequest { dep });
        }
      }

      dep_nodes = new_dep_nodes;
      let resolved = request_tracker.run_requests(path_requests);

      asset_requests = resolved
        .into_iter()
        .zip(dep_nodes.iter())
        .map(|(result, node)| AssetRequest {
          transformers: &config.transformers,
          file_path: result.unwrap(),
          env: match graph.graph.node_weight(*node).unwrap() {
            AssetGraphNode::Dependency(dep) => dep.env.clone(),
            _ => unreachable!(),
          },
        })
        .filter(|req| visited.insert(req.id()))
        .collect();
    }

    graph
  }
}
