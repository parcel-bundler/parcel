use crate::{asset_graph::AssetGraph, bundle::Bundle};

pub struct BundleGraph {
  pub asset_graph: AssetGraph,
  pub bundles: Vec<Bundle>,
}
