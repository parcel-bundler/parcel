use fixedbitset::FixedBitSet;
use parcel_core::{
  AssetGraph, AssetIndex, BundleBehavior, DependencyFlags, Priority, SpecifierType,
};

pub struct BundleRoots {
  // Dense root ID -> root asset. IDs are assigned once in asset-index order.
  root_assets: Vec<AssetIndex>,
  // Asset index -> dense root ID, or u32::MAX for assets that were never roots.
  root_indices: Vec<u32>,
  // Dense root IDs still requiring independently loadable bundles.
  active_roots: FixedBitSet,
  // Root-indexed subset that is directly entered and cannot inherit availability.
  entry_roots: FixedBitSet,
  // Roots with a reason other than a lazy module import.
  // Internalizing imports must not remove these externally observable outputs.
  mandatory_roots: FixedBitSet,
  // Effective behavior per root, combining asset metadata with incoming dependency overrides.
  bundle_behaviors: Vec<BundleBehavior>,
}

impl BundleRoots {
  pub fn from_asset_graph(asset_graph: &AssetGraph) -> BundleRoots {
    let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut entry_assets = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut mandatory_assets = FixedBitSet::with_capacity(asset_graph.assets.len());
    for entry in asset_graph.entries.iter() {
      if let Some(asset) = asset_graph.resolved_entry(entry) {
        bundle_roots.insert(asset.index());
        entry_assets.insert(asset.index());
        mandatory_assets.insert(asset.index());
      }
    }

    // Asset-indexed scratch storage is needed until every root has a dense ID.
    // It is compressed to root-indexed storage before this method returns.
    let mut asset_bundle_behaviors = asset_graph
      .assets
      .iter()
      .map(|asset| asset.bundle_behavior)
      .collect::<Vec<_>>();

    // Use dfs so we only process live assets, not deleted assets from a previous build.
    for (asset_index, asset, _) in asset_graph.dfs() {
      if asset_bundle_behaviors[asset_index.index()] != BundleBehavior::None {
        bundle_roots.insert(asset_index.index());
        mandatory_assets.insert(asset_index.index());
      }

      for dep_index in 0..asset.dependencies.len() {
        let dep = &asset_graph.asset(asset_index).dependencies[dep_index];
        if dep.bundle_behavior != BundleBehavior::None || dep.priority != Priority::Sync {
          if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
            let bundle_behavior = dep.bundle_behavior;
            bundle_roots.insert(resolved_asset_index.index());
            if dep.priority != Priority::Lazy
              || dep.specifier_type == SpecifierType::Url
              || dep.bundle_behavior != BundleBehavior::None
              || dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME)
            {
              mandatory_assets.insert(resolved_asset_index.index());
            }
            let target_bundle_behavior = &mut asset_bundle_behaviors[resolved_asset_index.index()];
            if bundle_behavior != BundleBehavior::None
              && *target_bundle_behavior == BundleBehavior::None
            {
              *target_bundle_behavior = bundle_behavior;
            }
          }
        }
      }
    }

    // All entries, mandatory outputs, and assets with effective bundle behavior
    // are roots. Compress their retained metadata into the dense root index.
    let root_assets: Vec<_> = bundle_roots.ones().map(AssetIndex::from_index).collect();
    let mut root_indices = vec![u32::MAX; asset_graph.assets.len()];
    let mut entry_roots = FixedBitSet::with_capacity(root_assets.len());
    let mut mandatory_roots = FixedBitSet::with_capacity(root_assets.len());
    let mut bundle_behaviors = Vec::with_capacity(root_assets.len());
    for (root, asset) in root_assets.iter().enumerate() {
      root_indices[asset.index()] = root as u32;
      if entry_assets.contains(asset.index()) {
        entry_roots.insert(root);
      }
      if mandatory_assets.contains(asset.index()) {
        mandatory_roots.insert(root);
      }
      bundle_behaviors.push(asset_bundle_behaviors[asset.index()]);
    }

    let mut active_roots = FixedBitSet::with_capacity(root_assets.len());
    active_roots.insert_range(..);

    BundleRoots {
      root_assets,
      root_indices,
      active_roots,
      entry_roots,
      mandatory_roots,
      bundle_behaviors,
    }
  }

  // Number of stable dense root IDs, including roots removed by internalization.
  pub fn len(&self) -> usize {
    self.root_assets.len()
  }

  // Active roots with their stable dense IDs.
  pub fn iter_active(&self) -> impl Iterator<Item = (usize, AssetIndex)> {
    self
      .active_roots
      .ones()
      .map(|root| (root, self.root_assets[root]))
  }

  // Every initially discovered root with its stable dense ID.
  pub fn iter_all(&self) -> impl Iterator<Item = (usize, AssetIndex)> + '_ {
    self.root_assets.iter().copied().enumerate()
  }

  pub fn root_index(&self, asset: AssetIndex) -> Option<usize> {
    let root = self.root_indices[asset.index()];
    (root != u32::MAX).then_some(root as usize)
  }

  pub fn is_bundle_root(&self, id: AssetIndex) -> bool {
    self
      .root_index(id)
      .is_some_and(|root| self.active_roots.contains(root))
  }

  pub fn is_original_root(&self, id: AssetIndex) -> bool {
    self.root_indices[id.index()] != u32::MAX
  }

  pub fn is_entry(&self, id: AssetIndex) -> bool {
    self
      .root_index(id)
      .is_some_and(|root| self.is_entry_root(root))
  }

  pub fn bundle_behavior(&self, id: AssetIndex) -> BundleBehavior {
    self
      .root_index(id)
      .map_or(BundleBehavior::None, |root| self.root_bundle_behavior(root))
  }

  pub fn is_entry_root(&self, root: usize) -> bool {
    self.entry_roots.contains(root)
  }

  pub fn root_bundle_behavior(&self, root: usize) -> BundleBehavior {
    self.bundle_behaviors[root]
  }

  pub fn is_mandatory(&self, root: usize) -> bool {
    self.mandatory_roots.contains(root)
  }

  pub fn is_active(&self, root: usize) -> bool {
    self.active_roots.contains(root)
  }

  pub fn retain_active(&self, roots: &mut FixedBitSet) {
    roots.intersect_with(&self.active_roots);
  }

  pub fn deactivate(&mut self, root: usize) {
    self.active_roots.set(root, false);
  }
}
