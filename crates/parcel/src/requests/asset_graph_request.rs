use parcel_core::asset_graph::{AssetGraph, AssetGraphNode};
use petgraph::graph::NodeIndex;

use crate::{
  request_tracker::{Request, RequestResult, RequestTracker, RunRequestContext, RunRequestError},
  ParcelOptions,
};

use super::entry_request::EntryRequest;

/// The AssetGraphRequest is in charge of building the AssetGraphRequest
/// In doing so, it kicks of the TargetRequest, PathRequest and AssetRequests.
#[derive(Hash)]
pub struct AssetGraphRequest {
  pub entries: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AssetGraphResult {}

impl Request<AssetGraphResult> for AssetGraphRequest {
  fn run(
    &self,
    request_context: RunRequestContext<AssetGraphResult>,
  ) -> Result<RequestResult<AssetGraphResult>, RunRequestError> {
    let mut graph = AssetGraph::new();
    let root = graph.graph.add_node(AssetGraphNode::Root);

    request_context.start_request_queue(|request_queue| {
      for entry in self.entries {
        request_queue.queue_request(Box::new(EntryRequest {
          entry: entry.clone(),
        }));
      }
    });
  }
}

// Devon's code from here

// pub struct AssetGraphRequest<'a> {
//   pub entries: &'a Vec<String>,
//   pub transformers: &'a PipelineMap,
//   pub resolvers: &'a Vec<PluginNode>,
// }
//
// impl<'a> AssetGraphRequest<'a> {
//   pub fn build(
//     &mut self,
//     request_tracker: &mut RequestTracker,
//     farm: &WorkerFarm,
//     options: &ParcelOptions,
//   ) -> Result<AssetGraph, Vec<Diagnostic>> {
//     let mut graph = AssetGraph::new();
//     let root = graph.graph.add_node(AssetGraphNode::Root);
//     let named_pipelines = self.transformers.named_pipelines();
//
//     scope(request_tracker, farm, options, |scope| {
//       for entry in self.entries {
//         // Currently some tests depend on the order of the entry dependencies
//         // in the graph. Insert a placeholder node here so that the dependency
//         // order is consistent no matter which order the requests resolve in.
//         let node = graph.graph.add_node(AssetGraphNode::Entry);
//         graph.graph.add_edge(root, node, AssetGraphEdge {});
//         scope.queue_request(
//           EntryRequest {
//             entry: entry.clone(),
//           },
//           node,
//         );
//       }
//
//       let mut visited = HashSet::new();
//       let mut asset_request_to_asset = HashMap::new();
//       let mut waiting_asset_requests = HashMap::<u64, HashSet<NodeIndex>>::new();
//
//       while let Some((request, node, result)) = scope.receive_result() {
//         match result {
//           Ok(RequestOutput::EntryRequest(entries)) => {
//             for entry in entries {
//               scope.queue_request(TargetRequest { entry }, node);
//             }
//           }
//           Ok(RequestOutput::TargetRequest(result)) => {
//             for target in result.targets {
//               let mut dep = Dependency::new(result.entry.to_string(), target.env);
//               dep.specifier_type = SpecifierType::Url;
//               dep.target = Some(Box::new(target));
//               dep.flags |= DependencyFlags::ENTRY | DependencyFlags::NEEDS_STABLE_NAME;
//               let mut requested_symbols = InternedSet::default();
//               if dep.env.flags.contains(EnvironmentFlags::IS_LIBRARY) {
//                 dep.flags |= DependencyFlags::HAS_SYMBOLS;
//                 dep.symbols.push(Symbol {
//                   exported: "*".into(),
//                   local: "*".into(),
//                   flags: SymbolFlags::IS_WEAK,
//                   loc: None,
//                 });
//                 requested_symbols.insert("*".into());
//               }
//
//               let dep_node = graph.add_dependency(dep.clone(), requested_symbols);
//               graph.graph.add_edge(node, dep_node, AssetGraphEdge {});
//               scope.queue_request(
//                 PathRequest {
//                   dep,
//                   resolvers: &self.resolvers,
//                   named_pipelines: &named_pipelines,
//                 },
//                 dep_node,
//               );
//             }
//           }
//           Ok(RequestOutput::PathRequest(res)) => {
//             let dep_index = graph.dependency_index(node).unwrap();
//             let DependencyNode {
//               dependency,
//               requested_symbols,
//               state,
//             } = &mut graph.dependencies[dep_index];
//             let asset_request = match res {
//               ResolverResult::Resolved {
//                 path,
//                 code,
//                 pipeline,
//                 side_effects,
//                 query,
//               } => {
//                 if !side_effects
//                   && requested_symbols.is_empty()
//                   && dependency.flags.contains(DependencyFlags::HAS_SYMBOLS)
//                 {
//                   *state = DependencyState::Deferred;
//                   continue;
//                 }
//
//                 *state = DependencyState::Resolved;
//                 AssetRequest {
//                   transformers: &self.transformers,
//                   file_path: path,
//                   code: code.clone(),
//                   pipeline: pipeline.clone(),
//                   side_effects: side_effects.clone(),
//                   env: dependency.env,
//                   query,
//                 }
//               }
//               ResolverResult::Excluded => {
//                 *state = DependencyState::Excluded;
//                 continue;
//               }
//               _ => todo!(),
//             };
//
//             let id = asset_request.id();
//             if visited.insert(id) {
//               scope.queue_request(asset_request, node);
//             } else {
//               if let Some(asset_node) = asset_request_to_asset.get(&id) {
//                 graph.graph.add_edge(node, *asset_node, AssetGraphEdge {});
//
//                 graph.propagate_requested_symbols(
//                   *asset_node,
//                   node,
//                   &mut |dep_node, dependency| {
//                     scope.queue_request(
//                       PathRequest {
//                         dep: dependency.clone(),
//                         resolvers: &self.resolvers,
//                         named_pipelines: &named_pipelines,
//                       },
//                       dep_node,
//                     );
//                   },
//                 );
//               } else {
//                 waiting_asset_requests
//                   .entry(id)
//                   .and_modify(|nodes| {
//                     nodes.insert(node);
//                   })
//                   .or_insert_with(|| HashSet::from([node]));
//               }
//             }
//           }
//           Ok(RequestOutput::AssetRequest(res)) => {
//             let asset_node = graph.add_asset(res.asset.clone());
//             asset_request_to_asset.insert(request, asset_node);
//             graph.graph.add_edge(node, asset_node, AssetGraphEdge {});
//
//             for dep in &res.dependencies {
//               let dep_node = graph.add_dependency(dep.clone(), InternedSet::default());
//               graph
//                 .graph
//                 .add_edge(asset_node, dep_node, AssetGraphEdge {});
//             }
//
//             graph.propagate_requested_symbols(asset_node, node, &mut |dep_node, dependency| {
//               scope.queue_request(
//                 PathRequest {
//                   dep: dependency.clone(),
//                   resolvers: &self.resolvers,
//                   named_pipelines: &named_pipelines,
//                 },
//                 dep_node,
//               );
//             });
//
//             if let Some(waiting) = waiting_asset_requests.remove(&request) {
//               for dep in waiting {
//                 graph.graph.add_edge(dep, asset_node, AssetGraphEdge {});
//                 graph.propagate_requested_symbols(asset_node, dep, &mut |dep_node, dependency| {
//                   scope.queue_request(
//                     PathRequest {
//                       dep: dependency.clone(),
//                       resolvers: &self.resolvers,
//                       named_pipelines: &named_pipelines,
//                     },
//                     dep_node,
//                   );
//                 });
//               }
//             }
//           }
//           Err(diagnostics) => {
//             return Err(diagnostics);
//           }
//           _ => todo!(),
//         }
//       }
//
//       Ok(graph)
//     })
//   }
// }
//
// /// Runs a callback inside a rayon scope, and provides an interface to queue requests.
// fn scope<'scope, R, F: FnOnce(&mut Queue<'_, 'scope, T>) -> R, T: Clone>(
//   request_ctx: &'scope mut RunRequestContext<'scope, T>,
//   f: F,
// ) -> R {
//   let mut result = None;
//   rayon::in_place_scope(|scope| {
//     let (sender, receiver) = crossbeam_channel::unbounded();
//     let mut queue = Queue {
//       scope,
//       in_flight: 0,
//       request_ctx,
//       sender,
//       receiver,
//     };
//
//     result = Some(f(&mut queue));
//   });
//   result.unwrap()
// }
//
// struct Queue<'a, 'scope, T: Clone> {
//   scope: &'a rayon::Scope<'scope>,
//   in_flight: usize,
//   request_ctx: &'scope mut RunRequestContext<'scope, T>,
//   sender: crossbeam_channel::Sender<(NodeIndex, anyhow::Result<T>)>,
//   receiver: crossbeam_channel::Receiver<(NodeIndex, anyhow::Result<T>)>,
// }
//
// impl<'a, 'scope, T: Clone + Send> Queue<'a, 'scope, T> {
//   pub fn queue_request<'s: 'scope, R: Request<T> + Send + 'scope>(
//     &'a mut self,
//     req: R,
//     node: NodeIndex,
//   ) {
//     // TODO: If the request already has a cached result don't bother calling
//     // into another thread?
//     self.in_flight += 1;
//     let sender = self.sender.clone();
//     let request_ctx = self.request_ctx;
//     self.scope.spawn(move |_| {
//       let result = request_ctx.run_request(&req);
//       // Send the result back to the main thread via a channel.
//       // If this errors, the channel was closed due to a previous error.
//       drop(sender.send((node, result)));
//     });
//   }
//
//   pub fn receive_result(&mut self) -> Option<(NodeIndex, anyhow::Result<T>)> {
//     // If there are no requests in flight, the build is complete.
//     if self.in_flight == 0 {
//       return None;
//     }
//
//     if let Ok((node, result)) = self.receiver.recv() {
//       self.in_flight -= 1;
//       Some((node, result))
//     } else {
//       None
//     }
//   }
// }
