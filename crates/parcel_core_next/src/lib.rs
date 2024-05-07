pub mod cache;
pub mod environment;
pub mod graphs;
pub mod parcel_config;
pub mod plugins;
pub mod request_tracker;
pub mod types;
pub mod worker_farm;

use cache::Cache;
use graphs::AssetGraph;
use request_tracker::requests::asset_graph_request::AssetGraphRequest;
use request_tracker::RequestTracker;
// use requests::bundle_graph_request::BundleGraphRequest;
use worker_farm::WorkerFarm;

use crate::request_tracker::requests::parcel_config_request::ParcelConfigRequest;

pub fn build(entries: Vec<String>, farm: WorkerFarm, cache: &Cache) -> AssetGraph {
  let mut request_tracker = RequestTracker::new(farm);
  let config = request_tracker.run_request(ParcelConfigRequest {}).unwrap();

  let mut req = AssetGraphRequest {
    entries,
    transformers: &config.transformers,
    resolvers: &config.resolvers,
  };
  let asset_graph = req.build(&mut request_tracker, cache);

  // let bundles = request_tracker
  //   .run_request(BundleGraphRequest {
  //     asset_graph,
  //     bundler: config.bundler.clone(),
  //   })
  //   .unwrap();

  // println!("BUNDLES: {:?}", bundles);
  asset_graph
}
