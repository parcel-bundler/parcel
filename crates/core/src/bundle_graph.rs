use std::{
  collections::{HashMap, HashSet},
  sync::OnceLock,
};

use crate::{
  AssetIndex, AssetType, BundleBehavior, BundleFlags, DependencyResolution, PathId,
  asset_graph::AssetGraph, bundle::Bundle,
};

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
  /// Ids of page-hosted bundles (see `is_page_hosted`), computed on first use once bundling is
  /// complete.
  page_hosted: OnceLock<HashSet<u64>>,
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
      page_hosted: OnceLock::new(),
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
    // Emit a single common entry as the gate. Joining entries with `and` is
    // not generally valid media-query syntax (a media type must come first,
    // and entries may themselves be comma-separated lists), and the attribute
    // gates application, not just fetch priority, so an invalid gate would
    // disable the stylesheet entirely. Any single common entry is a sound
    // gate on its own: every asset's condition already requires it.
    common.first().map(|gate| gate.to_string())
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

  /// Bundles that dependencies of `bundle`'s assets resolve to (URL, lazy, isolated and inline
  /// references), in dependency order. May contain duplicates.
  pub fn bundle_dependency_targets<'b>(
    &'b self,
    bundle: &'b Bundle,
  ) -> impl Iterator<Item = usize> + 'b {
    bundle.assets.iter().flat_map(move |&asset_index| {
      let dependency_count = self.asset_graph.asset(asset_index).dependencies.len();
      (0..dependency_count).filter_map(move |dependency_index| {
        match self.dependency_resolution(asset_index, dependency_index) {
          BundleGraphDependencyResolution::Bundle { bundle_index, .. } => {
            Some(bundle_index as usize)
          }
          _ => None,
        }
      })
    })
  }

  /// Bundles that code in `root`'s execution context may load or resolve by stable key (see
  /// `Bundle::is_context_root`): everything reachable through bundle references and Parcel's
  /// loader, without entering other contexts. Workers, URL imports and other roots are included,
  /// but not their contents. The runtime resolves these through a manifest.
  pub fn context_closure(&self, root: &Bundle) -> Vec<usize> {
    let mut closure = Vec::new();
    let mut visited = vec![false; self.bundles.len()];
    let mut stack: Vec<usize> = self
      .bundle_dependency_targets(root)
      .chain(root.referenced_bundles.iter().copied())
      .collect();
    while let Some(index) = stack.pop() {
      if std::mem::replace(&mut visited[index], true) || self.bundles[index].id == root.id {
        continue;
      }
      let bundle = &self.bundles[index];
      // Inline content runs in this context, but has no name of its own.
      let enters = bundle.bundle_behavior == BundleBehavior::Inline
        || (bundle.ty == AssetType::Js
          && !bundle.is_context_root()
          && bundle.target.environment == root.target.environment);
      if bundle.bundle_behavior != BundleBehavior::Inline {
        closure.push(index);
      }
      if enters {
        stack.extend(self.bundle_dependency_targets(bundle));
        stack.extend(&bundle.referenced_bundles);
      }
    }
    closure.sort_unstable();
    closure
  }

  /// Whether `root` is only ever loaded by HTML pages Parcel builds, which then provide its
  /// context's manifest and load its static closure. Entries may be loaded by anything.
  pub fn is_page_hosted(&self, root: &Bundle) -> bool {
    let page_hosted = self.page_hosted.get_or_init(|| {
      // Bundles referenced by a page, minus those referenced by anything else.
      let mut by_page = vec![false; self.bundles.len()];
      let mut by_other = vec![false; self.bundles.len()];
      for (index, bundle) in self.bundles.iter().enumerate() {
        let is_page = matches!(bundle.ty, AssetType::Html | AssetType::Xhtml);
        for target in self.bundle_dependency_targets(bundle) {
          if target != index {
            if is_page {
              by_page[target] = true;
            } else {
              by_other[target] = true;
            }
          }
        }
      }
      self
        .bundles
        .iter()
        .enumerate()
        .filter(|&(index, bundle)| {
          by_page[index] && !by_other[index] && !bundle.flags.contains(BundleFlags::ENTRY)
        })
        .map(|(_, bundle)| bundle.id)
        .collect()
    });
    page_hosted.contains(&root.id)
  }

  /// The transitive closure of `referenced_bundles`, starting with `bundle_index` itself, in
  /// pre-order. Siblings keep their reference order, which is cascade order for CSS.
  pub fn referenced_bundles(&self, bundle_index: usize) -> impl Iterator<Item = usize> + '_ {
    let mut stack = vec![bundle_index];
    let mut seen = HashSet::new();

    std::iter::from_fn(move || {
      while let Some(index) = stack.pop() {
        if seen.insert(index) {
          stack.extend(self.bundles[index].referenced_bundles.iter().rev().copied());
          return Some(index);
        }
      }

      None
    })
  }
}
