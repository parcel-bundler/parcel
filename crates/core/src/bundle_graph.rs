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
  Bundle {
    bundle_index: u32,
    asset_index: AssetIndex,
  },
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

  /// The media query gating every asset in a CSS bundle, if any. Any media
  /// entry common to all assets' accumulated style conditions soundly gates
  /// loading the whole bundle, because each asset also wraps its own rules in
  /// its full condition; the gate is a fetch-priority hint, never the source
  /// of correctness.
  pub fn common_style_media(&self, bundle: &Bundle) -> Option<String> {
    let mut common: Option<Vec<&str>> = None;
    for asset_index in &bundle.assets {
      let asset = self.asset_graph.asset(*asset_index);
      let media = match &asset.target.style_condition {
        Some(condition) if !condition.media.is_empty() => &condition.media,
        // An unconditional asset means nothing gates the whole bundle.
        _ => return None,
      };
      common = Some(match common {
        None => media.iter().map(|m| &**m).collect(),
        Some(prev) => prev
          .into_iter()
          .filter(|m| media.iter().any(|entry| &**entry == *m))
          .collect(),
      });
      if common.as_ref().is_some_and(|c| c.is_empty()) {
        return None;
      }
    }
    let common = common?;
    // Entries are canonical media query lists. Comma-free entries are single
    // queries and can be conjoined with `and`; a list with top-level commas is
    // a disjunction, which can only gate on its own.
    let simple: Vec<&str> = common
      .iter()
      .copied()
      .filter(|m| !m.contains(','))
      .collect();
    if !simple.is_empty() {
      Some(simple.join(" and "))
    } else {
      Some(common[0].to_string())
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
      if let BundleGraphDependencyResolution::Bundle { bundle_index, .. } = res {
        Some((id.asset, *bundle_index as usize))
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
