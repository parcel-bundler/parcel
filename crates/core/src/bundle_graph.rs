use crate::{SourceUrl, asset_graph::AssetGraph, bundle::Bundle};

#[derive(Debug)]
pub struct BundleGraph {
  pub asset_graph: AssetGraph,
  pub bundles: Vec<Bundle>,
  pub project_root: SourceUrl,
}
