use std::collections::{HashMap, HashSet};
use std::sync::mpsc::channel;
use std::sync::Arc;

use parcel_core::asset_graph::{AssetGraph, DependencyNode, DependencyState};
use parcel_core::types::{Dependency, SpecifierType, Symbol};
use petgraph::graph::NodeIndex;

use crate::request_tracker::{
  Request, RequestId, ResultAndInvalidations, RunRequestContext, RunRequestError,
};

use super::asset_request::{AssetRequest, AssetRequestOutput};
use super::entry_request::{EntryRequest, EntryRequestOutput};
use super::path_request::{PathRequest, PathRequestOutput};
use super::target_request::{TargetRequest, TargetRequestOutput};
use super::RequestResult;

/// The AssetGraphRequest is in charge of building the AssetGraphRequest
/// In doing so, it kicks of the TargetRequest, PathRequest and AssetRequests.
#[derive(Debug, Hash)]
pub struct AssetGraphRequest {}

#[derive(Clone, Debug, PartialEq)]
pub struct AssetGraphRequestOutput {
  pub graph: AssetGraph,
}

impl Request for AssetGraphRequest {
  fn run(
    &self,
    mut request_context: RunRequestContext,
  ) -> Result<ResultAndInvalidations, RunRequestError> {
    let mut graph = AssetGraph::new();
    let (tx, rx) = channel();

    let _ = request_context.queue_request(
      EntryRequest {
        entry: request_context
          .options()
          .entries
          .as_ref()
          .expect("TODO: Handle implicit entries")
          .clone(),
      },
      tx.clone(),
    );

    let mut visited = HashSet::new();
    let mut asset_request_to_asset = HashMap::new();
    let mut waiting_asset_requests = HashMap::<u64, HashSet<NodeIndex>>::new();
    let mut request_id_to_dep_node_index = HashMap::<RequestId, NodeIndex>::new();

    // This allows us to defer PathRequests that are not yet known to be used as their requested
    // symbols are not yet referenced in any discovered Assets.
    macro_rules! on_undeferred {
      () => {
        &mut |dep_node, dependency: Arc<Dependency>| {
          let request = PathRequest {
            dependency: dependency.clone(),
            // TODO: Where should named pipelines come from?
            named_pipelines: vec![],
          };

          request_id_to_dep_node_index.insert(request.id(), dep_node);
          request_context.queue_request(request, tx.clone());
        };
      };
    }

    // let on_undeferred = &mut |dep_node, dependency: Arc<Dependency>| {
    //   let request = PathRequest {
    //     dependency: dependency.clone(),
    //     // TODO: Where should named pipelines come from?
    //     named_pipelines: vec![],
    //   };

    //   request_id_to_dep_node_index.insert(request.id(), dep_node);
    //   request_context.queue_request(request, tx.clone());
    // };

    while let result = rx.recv()? {
      match result {
        Ok((RequestResult::Entry(EntryRequestOutput { entries }), _request_id)) => {
          for entry in entries {
            let target_request = TargetRequest {
              default_target_options: request_context.options().default_target_options.clone(),
              entry,
              env: request_context.options().env.clone(),
              mode: request_context.options().mode.clone(),
            };

            let _ = request_context.queue_request(target_request, tx.clone());
          }
        }
        Ok((RequestResult::Target(TargetRequestOutput { entry, targets }), request_id)) => {
          let entry_node_index = *request_id_to_dep_node_index
            .get(&request_id)
            .expect("Missing node index for request id {request_id}");

          for target in targets {
            let mut dependency =
              Dependency::new(entry.to_string_lossy().into_owned(), target.env.clone());
            dependency.specifier_type = SpecifierType::Url;
            dependency.target = Some(Box::new(target));
            dependency.is_entry = true;
            dependency.needs_stable_name = true;

            let mut requested_symbols = HashSet::default();
            if dependency.env.is_library {
              dependency.has_symbols = true;
              dependency.symbols.push(Symbol {
                exported: "*".into(),
                local: "*".into(),
                is_weak: true,
                loc: None,
                is_esm_export: false,
                self_referenced: false,
              });
              requested_symbols.insert("*".into());
            }

            let dep_node =
              graph.add_dependency(entry_node_index, dependency.clone(), requested_symbols);

            let request = PathRequest {
              dependency: Arc::new(dependency),
              // TODO: Where should named pipelines come from?
              named_pipelines: vec![],
            };
            request_id_to_dep_node_index.insert(request.id(), dep_node);
            request_context.queue_request(request, tx.clone());
          }
        }
        Ok((
          RequestResult::Asset(AssetRequestOutput {
            asset,
            dependencies,
          }),
          request_id,
        )) => {
          let incoming_dep_node_index = *request_id_to_dep_node_index
            .get(&request_id)
            .expect("Missing node index for request id {request_id}");

          // Connect the incoming DependencyNode to the new AssetNode
          let asset_node_index = graph.add_asset(incoming_dep_node_index, asset.clone());

          asset_request_to_asset.insert(request_id, asset_node_index);

          // Connect dependencies of the Asset
          for dependency in &dependencies {
            let _ = graph.add_dependency(asset_node_index, dependency.clone(), HashSet::default());
          }

          graph.propagate_requested_symbols(
            asset_node_index,
            incoming_dep_node_index,
            on_undeferred!(),
          );

          // Connect any previously discovered Dependencies that were waiting
          // for this AssetNode to be created
          if let Some(waiting) = waiting_asset_requests.remove(&request_id) {
            for dep in waiting {
              graph.add_edge(&dep, &asset_node_index);
              graph.propagate_requested_symbols(asset_node_index, dep, on_undeferred!());
            }
          }
        }
        Ok((RequestResult::Path(result), request_id)) => {
          let node = *request_id_to_dep_node_index
            .get(&request_id)
            .expect("Missing node index for request id {request_id}");
          let dep_index = graph.dependency_index(node).unwrap();
          let DependencyNode {
            dependency,
            requested_symbols,
            state,
          } = &mut graph.dependencies[dep_index];
          let asset_request = match result {
            PathRequestOutput::Resolved {
              path,
              code,
              pipeline,
              side_effects,
              query,
              can_defer,
            } => {
              if !side_effects
                && can_defer
                && requested_symbols.is_empty()
                && dependency.has_symbols
              {
                *state = DependencyState::Deferred;
                continue;
              }

              *state = DependencyState::Resolved;
              AssetRequest {
                file_path: path,
                code: code.clone(),
                pipeline: pipeline.clone(),
                side_effects: side_effects.clone(),
                // TODO: Dependency.env should be an Arc by default
                env: Arc::new(dependency.env.clone()),
                query,
              }
            }
            PathRequestOutput::Excluded => {
              *state = DependencyState::Excluded;
              continue;
            }
          };

          let id = asset_request.id();
          if visited.insert(id) {
            request_id_to_dep_node_index.insert(id, node);
            request_context.queue_request(asset_request, tx.clone());
          } else if let Some(asset_node_index) = asset_request_to_asset.get(&id) {
            // We have already completed this AssetRequest so we can connect the
            // Dependency to the Asset immediately
            graph.add_edge(asset_node_index, &node);
            graph.propagate_requested_symbols(*asset_node_index, node, on_undeferred!());
          } else {
            // The AssetRequest has already been kicked off but is yet to
            // complete. Register this Dependency to be connected once it
            // completes
            waiting_asset_requests
              .entry(id)
              .and_modify(|nodes| {
                nodes.insert(node);
              })
              .or_insert_with(|| HashSet::from([node]));
          }
        }
        other => {
          todo!("{:?}", other);
        }
      }
    }

    Ok(ResultAndInvalidations {
      result: RequestResult::AssetGraph(AssetGraphRequestOutput { graph }),
      invalidations: vec![],
    })
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
// fn scope<'scope, R, F: FnOnce(&mut Queue<'_, 'scope>) -> R>(
//   request_tracker: &'scope mut RequestTracker,
//   farm: &'scope WorkerFarm,
//   options: &'scope ParcelOptions,
//   f: F,
// ) -> R {
//   let mut result = None;
//   rayon::in_place_scope(|scope| {
//     let (sender, receiver) = crossbeam_channel::unbounded();
//     let mut queue = Queue {
//       scope,
//       in_flight: 0,
//       farm,
//       options,
//       request_tracker,
//       sender,
//       receiver,
//     };
//
//     result = Some(f(&mut queue));
//   });
//   result.unwrap()
// }
//
// struct Queue<'a, 'scope> {
//   scope: &'a rayon::Scope<'scope>,
//   in_flight: usize,
//   farm: &'scope WorkerFarm,
//   options: &'scope ParcelOptions,
//   request_tracker: &'scope mut RequestTracker,
//   sender: crossbeam_channel::Sender<(
//     u64,
//     NodeIndex,
//     Result<RequestOutput, Vec<Diagnostic>>,
//     Vec<Invalidation>,
//   )>,
//   receiver: crossbeam_channel::Receiver<(
//     u64,
//     NodeIndex,
//     Result<RequestOutput, Vec<Diagnostic>>,
//     Vec<Invalidation>,
//   )>,
// }
//
// impl<'a, 'scope> Queue<'a, 'scope> {
//   pub fn queue_request<'s: 'scope, R: Request + StoreRequestOutput + Send + 'scope>(
//     &mut self,
//     req: R,
//     node: NodeIndex,
//   ) {
//     self.in_flight += 1;
//     if let Some(result) = self.request_tracker.start_request(&req) {
//       // We already have a result for this require, so just clone it and send it on the channel.
//       drop(self.sender.send((req.id(), node, Ok(result), vec![])));
//     } else {
//       // This request hasn't run before, so spawn a task in the thread pool.
//       let sender = self.sender.clone();
//       let farm = self.farm;
//       let options = self.options;
//       self.scope.spawn(move |_| {
//         let id = req.id();
//         let result = req.run(farm, options);
//         // Send the result back to the main thread via a channel.
//         // If this errors, the channel was closed due to a previous error.
//         drop(
//           sender.send((
//             id,
//             node,
//             result
//               .result
//               .map(|result| <R as StoreRequestOutput>::store(result)),
//             result.invalidations,
//           )),
//         );
//       });
//     }
//   }
//
//   pub fn receive_result(
//     &mut self,
//   ) -> Option<(u64, NodeIndex, Result<RequestOutput, Vec<Diagnostic>>)> {
//     // If there are no requests in flight, the build is complete.
//     if self.in_flight == 0 {
//       return None;
//     }
//
//     // Receive a result from the channel, and store the result in the RequestTracker.
//     if let Ok((request, node, result, invalidations)) = self.receiver.recv() {
//       self
//         .request_tracker
//         .finish_request(request, result.clone(), invalidations);
//       self.in_flight -= 1;
//       Some((request, node, result))
//     } else {
//       None
//     }
//   }
// }
