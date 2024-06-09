use std::collections::{HashMap, HashSet};

use petgraph::{
  graph::{DiGraph, NodeIndex},
  visit::EdgeRef,
  Direction,
};

use crate::{
  diagnostic::Diagnostic,
  environment::EnvironmentFlags,
  intern::{Interned, InternedSet},
  parcel_config::{PipelineMap, PluginNode},
  request_tracker::{Request, RequestOutput, RequestTracker, StoreRequestOutput},
  requests::{
    asset_request::AssetRequest,
    entry_request::EntryRequest,
    path_request::{PathRequest, ResolverResult},
    target_request::TargetRequest,
  },
  types::{Asset, Dependency, DependencyFlags, ParcelOptions, SpecifierType, Symbol, SymbolFlags},
  worker_farm::WorkerFarm,
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
  requested_symbols: InternedSet<String>,
}

#[derive(Debug, Clone)]
struct DependencyNode {
  dependency: Dependency,
  requested_symbols: InternedSet<String>,
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
    AssetGraph {
      graph: DiGraph::new(),
      assets: Vec::new(),
      dependencies: Vec::new(),
    }
  }

  pub fn add_dependency(
    &mut self,
    dep: Dependency,
    requested_symbols: InternedSet<String>,
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
    self.assets.push(AssetNode {
      asset,
      requested_symbols: InternedSet::default(),
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

#[derive(Debug, Clone)]
pub enum AssetGraphNode {
  Root,
  Entry,
  Asset(usize),
  Dependency(usize),
}

#[derive(Debug, Clone)]
pub struct AssetGraphEdge {}

impl AssetGraph {
  /// Propagates the requested symbols from an incoming dependency to an asset,
  /// and forwards those symbols to re-exported dependencies if needed.
  /// This may result in assets becoming un-deferred and transformed if they
  /// now have requested symbols.
  pub fn propagate_requested_symbols<F: FnMut(NodeIndex, &Dependency)>(
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

    let mut re_exports = InternedSet::default();
    let mut wildcards = InternedSet::default();
    let star = Interned::from("*");

    if requested_symbols.contains(&star) {
      // If the requested symbols includes the "*" namespace,
      // we need to include all of the asset's exported symbols.
      for sym in &asset.symbols {
        if asset_requested_symbols.insert(sym.exported) {
          if sym.flags.contains(SymbolFlags::IS_WEAK) {
            // Propagate re-exported symbol to dependency.
            re_exports.insert(sym.local);
          }
        }
      }

      // Propagate to all export * wildcard dependencies.
      wildcards.insert(star);
    } else {
      // Otherwise, add each of the requested symbols to the asset.
      for sym in requested_symbols.iter() {
        if asset_requested_symbols.insert(*sym) {
          if let Some(asset_symbol) = asset.symbols.iter().find(|s| s.exported == *sym) {
            if asset_symbol.flags.contains(SymbolFlags::IS_WEAK) {
              // Propagate re-exported symbol to dependency.
              re_exports.insert(asset_symbol.local);
            }
          } else {
            // If symbol wasn't found in the asset or a named re-export.
            // This means the symbol is in one of the export * wildcards, but we don't know
            // which one yet, so we propagate it to _all_ wildcard dependencies.
            wildcards.insert(*sym);
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
        if sym.flags.contains(SymbolFlags::IS_WEAK) {
          // This is a re-export. If it is a wildcard, add all unmatched symbols
          // to this dependency, otherwise attempt to match a named re-export.
          if sym.local == "*" {
            for wildcard in &wildcards {
              if requested_symbols.insert(*wildcard) {
                updated = true;
              }
            }
          } else if re_exports.contains(&sym.local) && requested_symbols.insert(sym.exported) {
            updated = true;
          }
        } else if requested_symbols.insert(sym.exported) {
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

pub struct AssetGraphRequest<'a> {
  pub entries: Vec<String>,
  pub transformers: &'a PipelineMap,
  pub resolvers: &'a Vec<PluginNode>,
}

impl<'a> AssetGraphRequest<'a> {
  pub fn build(
    &mut self,
    request_tracker: &mut RequestTracker,
    farm: &WorkerFarm,
    options: &ParcelOptions,
  ) -> Result<AssetGraph, Vec<Diagnostic>> {
    let mut graph = AssetGraph::new();
    let root = graph.graph.add_node(AssetGraphNode::Root);
    let named_pipelines = self.transformers.named_pipelines();

    scope(request_tracker, farm, options, |scope| {
      for entry in &self.entries {
        // Currently some tests depend on the order of the entry dependencies
        // in the graph. Insert a placeholder node here so that the dependency
        // order is consistent no matter which order the requests resolve in.
        let node = graph.graph.add_node(AssetGraphNode::Entry);
        graph.graph.add_edge(root, node, AssetGraphEdge {});
        scope.queue_request(
          EntryRequest {
            entry: entry.clone(),
          },
          node,
        );
      }

      let mut visited = HashSet::new();
      let mut asset_request_to_asset = HashMap::new();
      let mut waiting_asset_requests = HashMap::<u64, HashSet<NodeIndex>>::new();

      while let Some((request, node, result)) = scope.receive_result() {
        match result {
          Ok(RequestOutput::EntryRequest(entries)) => {
            for entry in entries {
              scope.queue_request(TargetRequest { entry }, node);
            }
          }
          Ok(RequestOutput::TargetRequest(result)) => {
            for target in result.targets {
              let mut dep = Dependency::new(result.entry.to_string(), target.env);
              dep.specifier_type = SpecifierType::Url;
              dep.target = Some(Box::new(target));
              dep.flags |= DependencyFlags::ENTRY | DependencyFlags::NEEDS_STABLE_NAME;
              let mut requested_symbols = InternedSet::default();
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
              graph.graph.add_edge(node, dep_node, AssetGraphEdge {});
              scope.queue_request(
                PathRequest {
                  dep,
                  resolvers: &self.resolvers,
                  named_pipelines: &named_pipelines,
                },
                dep_node,
              );
            }
          }
          Ok(RequestOutput::PathRequest(res)) => {
            let dep_index = graph.dependency_index(node).unwrap();
            let DependencyNode {
              dependency,
              requested_symbols,
              state,
            } = &mut graph.dependencies[dep_index];
            let asset_request = match res {
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
                  *state = DependencyState::Deferred;
                  continue;
                }

                *state = DependencyState::Resolved;
                AssetRequest {
                  transformers: &self.transformers,
                  file_path: path,
                  code: code.clone(),
                  pipeline: pipeline.clone(),
                  side_effects: side_effects.clone(),
                  env: dependency.env,
                }
              }
              ResolverResult::Excluded => {
                *state = DependencyState::Excluded;
                continue;
              }
              _ => todo!(),
            };

            let id = asset_request.id();
            if visited.insert(id) {
              scope.queue_request(asset_request, node);
            } else {
              if let Some(asset_node) = asset_request_to_asset.get(&id) {
                graph.graph.add_edge(node, *asset_node, AssetGraphEdge {});

                graph.propagate_requested_symbols(
                  *asset_node,
                  node,
                  &mut |dep_node, dependency| {
                    scope.queue_request(
                      PathRequest {
                        dep: dependency.clone(),
                        resolvers: &self.resolvers,
                        named_pipelines: &named_pipelines,
                      },
                      dep_node,
                    );
                  },
                );
              } else {
                waiting_asset_requests
                  .entry(id)
                  .and_modify(|nodes| {
                    nodes.insert(node);
                  })
                  .or_insert_with(|| HashSet::from([node]));
              }
            }
          }
          Ok(RequestOutput::AssetRequest(res)) => {
            let asset_node = graph.add_asset(res.asset.clone());
            asset_request_to_asset.insert(request, asset_node);
            graph.graph.add_edge(node, asset_node, AssetGraphEdge {});

            for dep in &res.dependencies {
              let dep_node = graph.add_dependency(dep.clone(), InternedSet::default());
              graph
                .graph
                .add_edge(asset_node, dep_node, AssetGraphEdge {});
            }

            graph.propagate_requested_symbols(asset_node, node, &mut |dep_node, dependency| {
              scope.queue_request(
                PathRequest {
                  dep: dependency.clone(),
                  resolvers: &self.resolvers,
                  named_pipelines: &named_pipelines,
                },
                dep_node,
              );
            });

            if let Some(waiting) = waiting_asset_requests.remove(&request) {
              for dep in waiting {
                graph.graph.add_edge(dep, asset_node, AssetGraphEdge {});
                graph.propagate_requested_symbols(asset_node, dep, &mut |dep_node, dependency| {
                  scope.queue_request(
                    PathRequest {
                      dep: dependency.clone(),
                      resolvers: &self.resolvers,
                      named_pipelines: &named_pipelines,
                    },
                    dep_node,
                  );
                });
              }
            }
          }
          Err(diagnostics) => {
            return Err(diagnostics);
          }
          _ => todo!(),
        }
      }

      Ok(graph)
    })
  }
}

/// Runs a callback inside a rayon scope, and provides an interface to queue requests.
fn scope<'scope, R, F: FnOnce(&mut Queue<'_, 'scope>) -> R>(
  request_tracker: &'scope mut RequestTracker,
  farm: &'scope WorkerFarm,
  options: &'scope ParcelOptions,
  f: F,
) -> R {
  let mut result = None;
  rayon::in_place_scope(|scope| {
    let (sender, receiver) = crossbeam_channel::unbounded();
    let mut queue = Queue {
      scope,
      in_flight: 0,
      farm,
      options,
      request_tracker,
      sender,
      receiver,
    };

    result = Some(f(&mut queue));
  });
  result.unwrap()
}

struct Queue<'a, 'scope> {
  scope: &'a rayon::Scope<'scope>,
  in_flight: usize,
  farm: &'scope WorkerFarm,
  options: &'scope ParcelOptions,
  request_tracker: &'scope mut RequestTracker,
  sender: crossbeam_channel::Sender<(u64, NodeIndex, Result<RequestOutput, Vec<Diagnostic>>)>,
  receiver: crossbeam_channel::Receiver<(u64, NodeIndex, Result<RequestOutput, Vec<Diagnostic>>)>,
}

impl<'a, 'scope> Queue<'a, 'scope> {
  pub fn queue_request<'s: 'scope, R: Request + StoreRequestOutput + Send + 'scope>(
    &mut self,
    req: R,
    node: NodeIndex,
  ) {
    self.in_flight += 1;
    if self.request_tracker.start_request(&req) {
      // This request hasn't run before, so spawn a task in the thread pool.
      let sender = self.sender.clone();
      let farm = self.farm;
      let options = self.options;
      self.scope.spawn(move |_| {
        let id = req.id();
        let result = req.run(farm, options);
        // Send the result back to the main thread via a channel.
        // If this errors, the channel was closed due to a previous error.
        drop(
          sender.send((
            id,
            node,
            result
              .result
              .map(|result| <R as StoreRequestOutput>::store(result)),
          )),
        );
      });
    } else {
      // We already have a result for this require, so just clone it and send it on the channel.
      let result = self.request_tracker.get_request_result(&req);
      drop(self.sender.send((req.id(), node, result.clone())));
    }
  }

  pub fn receive_result(
    &mut self,
  ) -> Option<(u64, NodeIndex, Result<RequestOutput, Vec<Diagnostic>>)> {
    // If there are no requests in flight, the build is complete.
    if self.in_flight == 0 {
      return None;
    }

    // Receive a result from the channel, and store the result in the RequestTracker.
    if let Ok((request, node, result)) = self.receiver.recv() {
      self.request_tracker.finish_request(request, result.clone());
      self.in_flight -= 1;
      Some((request, node, result))
    } else {
      None
    }
  }
}
