use std::{
  collections::{HashMap, VecDeque},
  path::PathBuf,
  sync::Arc,
};

use petgraph::{
  Direction,
  graph::{DiGraph, NodeIndex},
};

use crate::{
  Asset, AssetFlags, AssetType, Dependency, DependencyFlags, Diagnostic, SourceLocation,
  config::ParcelConfig,
  fs::FileSystem,
  resolver::{ResolverResult, resolve},
  transformer::transform,
};

#[derive(Debug, Clone)]
pub struct AssetGraph {
  pub graph: DiGraph<AssetGraphNode, ()>,
  pub assets: Vec<Asset>,
  pub dependencies: Vec<DependencyNode>,
}

#[derive(Debug, Clone)]
pub enum AssetGraphNode {
  Root,
  Entry,
  Asset(usize),
  Dependency(usize),
}

#[derive(Debug, Clone)]
pub struct DependencyNode {
  pub dependency: Dependency,
  state: DependencyState,
}

#[derive(Debug, Clone, PartialEq)]
enum DependencyState {
  New,
  Deferred,
  Excluded,
  Resolved,
}

impl AssetGraph {
  pub fn new() -> Self {
    let mut graph = DiGraph::new();
    graph.add_node(AssetGraphNode::Root);
    AssetGraph {
      graph,
      assets: Vec::new(),
      dependencies: Vec::new(),
    }
  }

  pub fn add_dependency(&mut self, dep: Dependency) -> NodeIndex {
    let idx = self.dependencies.len();
    self.dependencies.push(DependencyNode {
      dependency: dep,
      state: DependencyState::New,
    });
    self.graph.add_node(AssetGraphNode::Dependency(idx))
  }

  pub fn add_asset(&mut self, asset: Asset) -> NodeIndex {
    let idx = self.assets.len();
    self.assets.push(asset);
    self.graph.add_node(AssetGraphNode::Asset(idx))
  }

  pub fn dependency_assets<'a>(
    &'a self,
    dep: NodeIndex,
  ) -> impl Iterator<Item = (usize, &'a Asset)> + 'a {
    self
      .graph
      .neighbors_directed(dep, Direction::Outgoing)
      .map(|node| {
        let AssetGraphNode::Asset(asset_index) = self.graph[node] else {
          unreachable!()
        };
        (asset_index, &self.assets[asset_index])
      })
  }

  pub fn incoming_dependencies<'a>(
    &'a self,
    asset: NodeIndex,
  ) -> impl Iterator<Item = (usize, &'a Dependency)> + 'a {
    self
      .graph
      .neighbors_directed(asset, Direction::Incoming)
      .map(|node| {
        let AssetGraphNode::Dependency(dep_index) = self.graph[node] else {
          unreachable!()
        };
        (dep_index, &self.dependencies[dep_index].dependency)
      })
  }
}

enum Request {
  Dependency(NodeIndex),
  Asset {
    path: PathBuf,
    pipeline: Option<String>,
    dep_node: NodeIndex,
  },
}

pub fn build_asset_graph(
  entries: Vec<String>,
  config: &ParcelConfig,
  fs: &dyn FileSystem,
) -> Result<AssetGraph, Vec<Diagnostic>> {
  let mut graph = AssetGraph::new();
  let named_pipelines = config.transformers.named_pipelines();
  let mut queue = VecDeque::new();
  let mut assets = HashMap::<(PathBuf, Option<String>), Vec<NodeIndex>>::new();

  for entry in entries {
    let dep = Dependency {
      specifier: entry,
      specifier_type: crate::SpecifierType::Esm,
      priority: crate::Priority::Sync,
      bundle_behavior: crate::BundleBehavior::None,
      flags: DependencyFlags::ENTRY,
      env: Arc::new(Default::default()),
      loc: None,
      placeholder: None,
      resolve_from: None,
      range: None,
    };

    let node = graph.add_dependency(dep);
    graph.graph.add_edge(NodeIndex::new(0), node, ());
    queue.push_back(Request::Dependency(node));
  }

  while let Some(request) = queue.pop_front() {
    match request {
      Request::Dependency(node) => {
        let AssetGraphNode::Dependency(index) = graph.graph[node] else {
          unreachable!("invalid graph state")
        };

        let dep = &graph.dependencies[index];
        let resolved = resolve(&dep.dependency, &config.resolvers, &named_pipelines)?;
        match resolved {
          ResolverResult::Resolved {
            path,
            code,
            pipeline,
            side_effects,
            query,
          } => {
            graph.dependencies[index].state = DependencyState::Resolved;
            if let Some(nodes) = assets.get(&(path.clone(), pipeline.clone())) {
              for asset_node in nodes {
                graph.graph.add_edge(node, *asset_node, ());
              }
            } else {
              queue.push_back(Request::Asset {
                path,
                pipeline,
                dep_node: node,
              });
            }
          }
          ResolverResult::Excluded => {
            graph.dependencies[index].state = DependencyState::Excluded;
          }
          _ => {}
        }
      }
      Request::Asset {
        path,
        pipeline,
        dep_node,
      } => {
        let AssetGraphNode::Dependency(index) = graph.graph[dep_node] else {
          unreachable!("invalid graph state")
        };

        let dep = &graph.dependencies[index];
        let transformer_pipeline = config.transformers.get(&path, &pipeline, false);
        let asset = Asset {
          ty: AssetType::from_path(&path),
          content: fs.read(&path).map_err(|e| vec![e.into()])?,
          loc: Some(SourceLocation {
            file_path: path.clone(),
            ..Default::default()
          }),
          env: dep.dependency.env.clone(),
          pipeline: pipeline.clone(),
          bundle_behavior: crate::BundleBehavior::None,
          flags: AssetFlags::empty(),
          unique_key: None,
        };
        let results = transform(asset, transformer_pipeline, &config.transformers)?;
        let mut nodes = Vec::new();
        for result in results {
          let asset_node = graph.add_asset(result.asset);
          graph.graph.add_edge(dep_node, asset_node, ());
          nodes.push(asset_node);

          for dep in result.dependencies {
            let dep_node = graph.add_dependency(dep);
            graph.graph.add_edge(asset_node, dep_node, ());

            queue.push_back(Request::Dependency(dep_node));
          }
        }

        assets.insert((path, pipeline), nodes);
      }
    }
  }

  Ok(graph)
}

#[cfg(test)]
mod tests {
  use std::path::Path;

  use indexmap::indexmap;

  use super::*;
  use crate::{
    config::{PipelineMap, PipelineNode, Plugin},
    fs::MemoryFileSystem,
    resolver::Resolver,
    transformer::{Transformer, TransformerResult},
  };

  struct TestResolver {}
  impl Resolver for TestResolver {
    fn resolve(
      &self,
      _dep: &Dependency,
      specifier: &str,
      _pipeline: Option<&str>,
    ) -> Result<ResolverResult, Vec<Diagnostic>> {
      Ok(ResolverResult::Resolved {
        path: format!("{}.js", specifier).into(),
        code: None,
        pipeline: None,
        side_effects: false,
        query: None,
      })
    }
  }

  struct TestTransformer {}
  impl Transformer for TestTransformer {
    fn transform(&self, mut asset: Asset) -> Result<Vec<TransformerResult>, Vec<Diagnostic>> {
      asset.content = "transformed!".as_bytes().to_vec();
      Ok(vec![TransformerResult {
        dependencies: vec![Dependency {
          specifier: "bar".into(),
          specifier_type: crate::SpecifierType::Esm,
          priority: crate::Priority::Sync,
          bundle_behavior: crate::BundleBehavior::None,
          flags: DependencyFlags::empty(),
          env: asset.env.clone(),
          loc: asset.loc.clone(),
          placeholder: None,
          resolve_from: None,
          range: None,
        }],
        asset,
      }])
    }
  }

  #[test]
  fn test_build_asset_graph() {
    let config = ParcelConfig {
      resolvers: vec![Plugin {
        package_name: "resolver".into(),
        key_path: None,
        plugin: Arc::new(TestResolver {}),
      }],
      transformers: PipelineMap(indexmap! {
        "*.js".into() => vec![PipelineNode::Plugin(Plugin::<dyn Transformer> {
          package_name: "transformer".into(),
          key_path: None,
          plugin: Arc::new(TestTransformer {})
        })]
      }),
      ..Default::default()
    };

    let mut fs = MemoryFileSystem::new();
    fs.write(Path::new("foo.js"), "foo".into()).expect("error");
    fs.write(Path::new("bar.js"), "bar".into()).expect("error");

    let graph = build_asset_graph(vec!["foo".into()], &config, &fs).unwrap();
    // println!("{:?}", graph)

    assert_eq!(graph.assets.len(), 2);
    assert_eq!(graph.dependencies.len(), 3);
  }
}
