use std::collections::HashMap;

use crate::{DependencyResolution, PathId, asset_graph::AssetGraph, bundle::Bundle};

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct DependencyId {
  pub asset: usize,
  pub dependency: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleGraphDependencyResolution {
  None,
  Deferred,
  External,
  Excluded,
  Asset(u32),
  Bundle(u32),
}

#[derive(Debug)]
pub struct BundleGraph<'a> {
  pub asset_graph: AssetGraph<'a>,
  pub bundles: Vec<Bundle>,
  dependency_resolutions: HashMap<DependencyId, u32>,
  pub project_root: PathId,
}

impl<'a> BundleGraph<'a> {
  pub fn new(
    asset_graph: AssetGraph<'a>,
    bundles: Vec<Bundle>,
    dependency_resolutions: HashMap<DependencyId, u32>,
    project_root: PathId,
  ) -> Self {
    BundleGraph {
      asset_graph,
      bundles,
      dependency_resolutions,
      project_root,
    }
  }

  pub fn dependency_resolution(
    &self,
    asset_index: usize,
    dependency_index: usize,
  ) -> BundleGraphDependencyResolution {
    if let Some(bundle_index) = self.dependency_resolutions.get(&DependencyId {
      asset: asset_index,
      dependency: dependency_index,
    }) {
      return BundleGraphDependencyResolution::Bundle(*bundle_index);
    }

    let dep = &self.asset_graph.assets[asset_index]
      .expect_asset()
      .dependencies[dependency_index];
    match &dep.resolution {
      DependencyResolution::None => BundleGraphDependencyResolution::None,
      DependencyResolution::Deferred(_) => BundleGraphDependencyResolution::Deferred,
      DependencyResolution::External => BundleGraphDependencyResolution::External,
      DependencyResolution::Excluded => BundleGraphDependencyResolution::Excluded,
      DependencyResolution::Asset(asset) => BundleGraphDependencyResolution::Asset(*asset),
    }
  }
}
