use std::{
  collections::{HashMap, HashSet},
  sync::OnceLock,
};

use crate::{
  AssetIndex, AssetType, BundleBehavior, BundleFlags, DependencyResolution, Environment, PathId,
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

bitflags::bitflags! {
  /// The kinds of bundles that reference a bundle as a dependency target.
  #[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
  struct Referrers: u8 {
    /// HTML pages, which load its references and provide its manifest.
    const HTML = 1 << 0;
    /// SVG documents, which load its references.
    const SVG = 1 << 1;
    /// Anything else.
    const OTHER = 1 << 2;
  }
}

#[derive(Debug)]
pub struct BundleGraph<'a> {
  pub asset_graph: AssetGraph<'a>,
  pub bundles: Vec<Bundle>,
  dependency_resolutions: HashMap<DependencyId, BundleGraphDependencyResolution>,
  pub project_root: PathId,
  /// What kinds of bundles reference each bundle as a dependency target, by bundle id (see
  /// `is_page_hosted`), computed on first use once bundling is complete.
  referrers: OnceLock<HashMap<u64, Referrers>>,
  /// The first bundle containing each asset (see `first_bundle_containing`), computed on first use.
  first_bundles: OnceLock<Vec<u32>>,
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
      referrers: OnceLock::new(),
      first_bundles: OnceLock::new(),
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
      // Inline content runs in this context, but has no name of its own. Server rendering runs
      // client code in the same process as the server, sharing its runtime.
      let enters = bundle.bundle_behavior == BundleBehavior::Inline
        || (bundle.ty == AssetType::Js
          && !bundle.is_context_root()
          && (bundle.target.environment == root.target.environment
            || (root.target.environment == Environment::ReactServer
              && bundle.target.environment == Environment::ReactClient)));
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
    let referrers = self.referrers(root);
    !root.flags.contains(BundleFlags::ENTRY) && referrers == Referrers::HTML
  }

  /// Whether everything that loads `bundle` also loads the bundles it references
  /// (`referenced_bundles`, transitively): pages load the closure of each script and stylesheet,
  /// and Parcel's loaders load the closure of each bundle. Entries may be loaded by anything, and
  /// bundles reached by other dependencies (a CSS `@import`, a URL, inline content) are loaded
  /// without their references.
  pub fn is_loaded_with_references(&self, bundle: &Bundle) -> bool {
    !bundle.flags.contains(BundleFlags::ENTRY) && !self.referrers(bundle).contains(Referrers::OTHER)
  }

  fn referrers(&self, bundle: &Bundle) -> Referrers {
    let referrers = self.referrers.get_or_init(|| {
      let mut referrers: HashMap<u64, Referrers> = HashMap::new();
      for (index, referrer) in self.bundles.iter().enumerate() {
        for target in self.bundle_dependency_targets(referrer) {
          if target == index {
            continue;
          }
          let entry = referrers.entry(self.bundles[target].id).or_default();
          match referrer.ty {
            AssetType::Html | AssetType::Xhtml => *entry |= Referrers::HTML,
            AssetType::Svg => *entry |= Referrers::SVG,
            _ => *entry |= Referrers::OTHER,
          }
        }
      }
      referrers
    });
    referrers.get(&bundle.id).copied().unwrap_or_default()
  }

  /// The index of the first bundle containing `asset`, if any.
  pub fn first_bundle_containing(&self, asset: AssetIndex) -> Option<usize> {
    let first_bundles = self.first_bundles.get_or_init(|| {
      let mut first_bundles = vec![u32::MAX; self.asset_graph.assets.len()];
      for (index, bundle) in self.bundles.iter().enumerate().rev() {
        for asset in &bundle.assets {
          first_bundles[asset.index()] = index as u32;
        }
      }
      first_bundles
    });
    first_bundles
      .get(asset.index())
      .filter(|&&index| index != u32::MAX)
      .map(|&index| index as usize)
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
