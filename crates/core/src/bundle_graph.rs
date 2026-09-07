use std::collections::{HashMap, HashSet};

use crate::{AssetIndex, DependencyResolution, PathId, asset_graph::AssetGraph, bundle::Bundle};

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct DependencyId {
  pub asset: AssetIndex,
  pub dependency: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleGraphDependencyResolution {
  None,
  Deferred,
  External,
  Excluded,
  Asset(AssetIndex),
  Internalized(AssetIndex),
  Bundle(u32),
}

#[derive(Debug)]
pub struct BundleGraph<'a> {
  pub asset_graph: AssetGraph<'a>,
  pub bundles: Vec<Bundle>,
  dependency_resolutions: HashMap<DependencyId, BundleGraphDependencyResolution>,
  pub project_root: PathId,
}

impl<'a> BundleGraph<'a> {
  pub fn new(
    asset_graph: AssetGraph<'a>,
    bundles: Vec<Bundle>,
    dependency_resolutions: HashMap<DependencyId, BundleGraphDependencyResolution>,
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
    asset_index: AssetIndex,
    dependency_index: usize,
  ) -> BundleGraphDependencyResolution {
    if let Some(res) = self.dependency_resolutions.get(&DependencyId {
      asset: asset_index,
      dependency: dependency_index,
    }) {
      return res.clone();
    }

    let dep = &self.asset_graph.asset(asset_index).dependencies[dependency_index];
    match &dep.resolution {
      DependencyResolution::None => BundleGraphDependencyResolution::None,
      DependencyResolution::Deferred(_) => BundleGraphDependencyResolution::Deferred,
      DependencyResolution::External => BundleGraphDependencyResolution::External,
      DependencyResolution::Excluded => BundleGraphDependencyResolution::Excluded,
      DependencyResolution::Asset(asset_node_index) => {
        match self.asset_graph.asset_nodes[asset_node_index.index()].asset {
          Some(asset_index) => BundleGraphDependencyResolution::Asset(asset_index),
          None => BundleGraphDependencyResolution::Deferred,
        }
      }
    }
  }

  /// Iterates over `(referencing asset, resolved bundle index)` pairs for dependencies that
  /// resolve to a bundle (inline bundles and URL references).
  pub fn bundle_dependencies(&self) -> impl Iterator<Item = (AssetIndex, usize)> + '_ {
    self.dependency_resolutions.iter().filter_map(|(id, res)| {
      if let BundleGraphDependencyResolution::Bundle(b) = res {
        Some((id.asset, *b as usize))
      } else {
        None
      }
    })
  }

  pub fn referenced_bundles(&self, bundle_index: usize) -> impl Iterator<Item = usize> + '_ {
    let mut stack = vec![bundle_index];
    let mut seen = HashSet::new();

    std::iter::from_fn(move || {
      while let Some(index) = stack.pop() {
        if seen.insert(index) {
          stack.extend(self.bundles[index].referenced_bundles.iter().copied());
          return Some(index);
        }
      }

      None
    })
  }
}
