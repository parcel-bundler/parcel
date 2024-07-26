use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

use parcel_core::asset_graph::{AssetGraph, DependencyNode, DependencyState};
use parcel_core::types::Dependency;
use pathdiff::diff_paths;
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
    // TODO: Move this out later
    let mut work_count = 0;

    for entry in request_context.options.clone().entries.iter() {
      work_count += 1;
      let _ = request_context.queue_request(
        EntryRequest {
          entry: entry.clone(),
        },
        tx.clone(),
      );
    }

    let mut visited = HashSet::new();
    let mut asset_request_to_asset = HashMap::new();
    let mut waiting_asset_requests = HashMap::<u64, HashSet<NodeIndex>>::new();
    let mut request_id_to_dep_node_index = HashMap::<RequestId, NodeIndex>::new();

    // This allows us to defer PathRequests that are not yet known to be used as their requested
    // symbols are not yet referenced in any discovered Assets.
    fn on_undeferred<'a>(
      request_id_to_dep_node_index: &'a mut HashMap<RequestId, NodeIndex>,
      work_count: &'a mut i32,
      request_context: &'a mut RunRequestContext,
      tx: &'a Sender<anyhow::Result<(RequestResult, RequestId)>>,
    ) -> impl FnMut(NodeIndex, Arc<Dependency>) + 'a {
      |dependency_node_index: NodeIndex, dependency: Arc<Dependency>| {
        let request = PathRequest {
          dependency: dependency.clone(),
        };

        request_id_to_dep_node_index.insert(request.id(), dependency_node_index);
        tracing::debug!(
          "queueing a path request from on_undeferred, {}",
          dependency.specifier
        );
        *work_count += 1;
        let _ = request_context.queue_request(request, tx.clone());
      }
    }

    loop {
      if work_count == 0 {
        break;
      }

      let Ok(result) = rx.recv() else {
        break;
      };

      work_count -= 1;

      match result {
        Ok((RequestResult::Entry(EntryRequestOutput { entries }), _request_id)) => {
          tracing::debug!("EntryRequestOutput");
          for entry in entries {
            let target_request = TargetRequest {
              default_target_options: request_context.options.default_target_options.clone(),
              entry,
              env: request_context.options.env.clone(),
              mode: request_context.options.mode.clone(),
            };

            work_count += 1;
            let _ = request_context.queue_request(target_request, tx.clone());
          }
        }
        Ok((RequestResult::Target(TargetRequestOutput { entry, targets }), _request_id)) => {
          tracing::debug!("TargetRequestOutput");
          for target in targets {
            let entry =
              diff_paths(&entry, &request_context.project_root).unwrap_or_else(|| entry.clone());

            let dependency = Dependency::entry(entry.to_str().unwrap().to_string(), target);
            let mut requested_symbols = HashSet::default();

            if dependency.env.is_library {
              requested_symbols.insert("*".into());
            }

            let dep_node =
              graph.add_dependency(NodeIndex::new(0), dependency.clone(), requested_symbols);

            let request = PathRequest {
              dependency: Arc::new(dependency),
            };
            request_id_to_dep_node_index.insert(request.id(), dep_node);
            work_count += 1;
            let _ = request_context.queue_request(request, tx.clone());
          }
        }
        Ok((
          RequestResult::Asset(AssetRequestOutput {
            asset,
            dependencies,
          }),
          request_id,
        )) => {
          tracing::debug!("AssetRequestOutput: {}", asset.file_path.display());
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
            &mut on_undeferred(
              &mut request_id_to_dep_node_index,
              &mut work_count,
              &mut request_context,
              &tx,
            ),
          );

          // Connect any previously discovered Dependencies that were waiting
          // for this AssetNode to be created
          if let Some(waiting) = waiting_asset_requests.remove(&request_id) {
            for dep in waiting {
              graph.add_edge(&dep, &asset_node_index);
              graph.propagate_requested_symbols(
                asset_node_index,
                dep,
                &mut on_undeferred(
                  &mut request_id_to_dep_node_index,
                  &mut work_count,
                  &mut request_context,
                  &tx,
                ),
              );
            }
          }
        }
        Ok((RequestResult::Path(result), request_id)) => {
          tracing::debug!("PathRequestOutput: {:?}", result);
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
            tracing::debug!("queueing asset request for {}", dependency.specifier);
            request_id_to_dep_node_index.insert(id, node);
            work_count += 1;
            let _ = request_context.queue_request(asset_request, tx.clone());
          } else if let Some(asset_node_index) = asset_request_to_asset.get(&id) {
            // We have already completed this AssetRequest so we can connect the
            // Dependency to the Asset immediately
            tracing::debug!("queueing path request for {}", dependency.specifier);
            graph.add_edge(asset_node_index, &node);
            graph.propagate_requested_symbols(
              *asset_node_index,
              node,
              &mut on_undeferred(
                &mut request_id_to_dep_node_index,
                &mut work_count,
                &mut request_context,
                &tx,
              ),
            );
          } else {
            // The AssetRequest has already been kicked off but is yet to
            // complete. Register this Dependency to be connected once it
            // completes
            tracing::debug!("adding to waiting {}", dependency.specifier);
            waiting_asset_requests
              .entry(id)
              .and_modify(|nodes| {
                nodes.insert(node);
              })
              .or_insert_with(|| HashSet::from([node]));
          }
        }
        // A request has failed, for now we will fail the build
        Err(err) => return Err(err),
        // The next few branches should never happen
        Ok((RequestResult::AssetGraph(_), _)) => {
          todo!("The impossible has happened: {:?}", result)
        }
        #[cfg(test)]
        Ok((RequestResult::TestSub(_), _)) => {
          todo!("The impossible has happened: {:?}", result)
        }
        #[cfg(test)]
        Ok((RequestResult::TestMain(_), _)) => {
          todo!("The impossible has happened: {:?}", result)
        }
      }
    }

    Ok(ResultAndInvalidations {
      result: RequestResult::AssetGraph(AssetGraphRequestOutput { graph }),
      invalidations: vec![],
    })
  }
}
