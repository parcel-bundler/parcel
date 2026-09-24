use fixedbitset::FixedBitSet;
use indexmap::IndexMap;

use super::bit_matrix::{AsBitRow, BitRow};
use parcel_core::{
  AssetGraph, AssetIndex, BundleBehavior, DependencyFlags, Environment, Priority, SpecifierType,
};

pub struct BundleRoots {
  // Dense root ID -> its root assets: root r owns
  // root_members[root_offsets[r]..root_offsets[r + 1]]. A root has one asset
  // unless concurrent imports merged several (see `from_asset_graph`). IDs
  // are assigned once: independent roots in asset-index order, then concurrent
  // roots in discovery order, with members sorted by asset index.
  root_members: Vec<AssetIndex>,
  root_offsets: Vec<u32>,
  // Asset index -> dense root ID for every member, or u32::MAX for assets that were never roots.
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

    // Dynamic imports awaited together become one root, e.g. `Promise.all([import('a'), import('b')])`.
    let mut concurrent_roots: IndexMap<(AssetIndex, u32, Environment), Vec<AssetIndex>> =
      IndexMap::new();
    let mut independent_assets = FixedBitSet::with_capacity(asset_graph.assets.len());

    for entry in asset_graph.entries.iter() {
      if let Some(asset) = asset_graph.resolved_entry(entry) {
        bundle_roots.insert(asset.index());
        entry_assets.insert(asset.index());
        mandatory_assets.insert(asset.index());
        independent_assets.insert(asset.index());
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
        independent_assets.insert(asset_index.index());
      }

      for dep_index in 0..asset.dependencies.len() {
        let dep = &asset_graph.asset(asset_index).dependencies[dep_index];
        if dep.bundle_behavior != BundleBehavior::None || dep.priority != Priority::Sync {
          if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
            let bundle_behavior = dep.bundle_behavior;
            let target_bundle_behavior = &mut asset_bundle_behaviors[resolved_asset_index.index()];
            if bundle_behavior != BundleBehavior::None
              && *target_bundle_behavior == BundleBehavior::None
            {
              *target_bundle_behavior = bundle_behavior;
            }

            if dep.priority != Priority::Lazy
              || dep.specifier_type == SpecifierType::Url
              || *target_bundle_behavior != BundleBehavior::None
              || dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME)
            {
              mandatory_assets.insert(resolved_asset_index.index());
              independent_assets.insert(resolved_asset_index.index());
            } else if dep.concurrent_group != 0 {
              let asset = asset_graph.asset(resolved_asset_index);
              let members = concurrent_roots
                .entry((asset_index, dep.concurrent_group, asset.target.environment))
                .or_default();
              // A target requested by multiple groups must keep its own root.
              // Repeated imports within this same group are still concurrent.
              if bundle_roots.contains(resolved_asset_index.index())
                && !members.contains(&resolved_asset_index)
              {
                independent_assets.insert(resolved_asset_index.index());
              }
              members.push(resolved_asset_index);
            } else {
              independent_assets.insert(resolved_asset_index.index());
            }

            bundle_roots.insert(resolved_asset_index.index());
          }
        } else if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
          // A synchronous reference loads this target without its concurrent
          // peers. Its root cannot stand in for those peers during placement.
          independent_assets.insert(resolved_asset_index.index());
        }
      }
    }

    // All entries, mandatory outputs, and assets with effective bundle behavior
    // are roots. Compress their retained metadata into the dense root index,
    // merging targets exclusive to one concurrent group into one root.
    let capacity = bundle_roots.count_ones(..);
    let mut root_members = Vec::new();
    let mut root_offsets = vec![0u32];
    let mut root_indices = vec![u32::MAX; asset_graph.assets.len()];
    let mut entry_roots = FixedBitSet::with_capacity(capacity);
    let mut mandatory_roots = FixedBitSet::with_capacity(capacity);
    let mut bundle_behaviors = Vec::with_capacity(capacity);
    for asset in bundle_roots.ones().map(AssetIndex::from_index) {
      if !independent_assets.contains(asset.index()) {
        continue;
      }

      let root = root_offsets.len() - 1;
      root_indices[asset.index()] = root as u32;
      if entry_assets.contains(asset.index()) {
        entry_roots.insert(root);
      }
      if mandatory_assets.contains(asset.index()) {
        mandatory_roots.insert(root);
      }
      bundle_behaviors.push(asset_bundle_behaviors[asset.index()]);
      root_members.push(asset);
      root_offsets.push(root_members.len() as u32);
    }

    for (_group, mut members) in concurrent_roots.drain(..) {
      members.sort_unstable();
      members.dedup();

      let mut root = None;
      for member in members {
        if independent_assets.contains(member.index()) {
          continue;
        }

        if root.is_none() {
          root = Some((root_offsets.len() - 1) as u32);
          bundle_behaviors.push(asset_bundle_behaviors[member.index()]);
        }
        root_members.push(member);
        root_indices[member.index()] = root.unwrap();
      }
      if !root.is_none() {
        root_offsets.push(root_members.len() as u32);
      }
    }

    let mut active_roots = FixedBitSet::with_capacity(bundle_behaviors.len());
    active_roots.insert_range(..);

    BundleRoots {
      root_members,
      root_offsets,
      root_indices,
      active_roots,
      entry_roots,
      mandatory_roots,
      bundle_behaviors,
    }
  }

  // Number of stable dense root IDs, including roots removed by internalization.
  pub fn len(&self) -> usize {
    self.bundle_behaviors.len()
  }

  // The root assets of a root: one, or several merged concurrent imports.
  pub fn members(&self, root: usize) -> &[AssetIndex] {
    &self.root_members[self.root_offsets[root] as usize..self.root_offsets[root + 1] as usize]
  }

  // A root's first member. Members share a type, environment and behavior,
  // so it stands in for the root wherever only those are consulted.
  pub fn representative(&self, root: usize) -> AssetIndex {
    self.members(root)[0]
  }

  // Active roots with their stable dense IDs.
  pub fn iter_active(&self) -> impl Iterator<Item = (usize, AssetIndex)> + '_ {
    self
      .active_roots
      .ones()
      .map(|root| (root, self.representative(root)))
  }

  // Every initially discovered root with its stable dense ID.
  pub fn iter_all(&self) -> impl Iterator<Item = (usize, AssetIndex)> + '_ {
    (0..self.len()).map(|root| (root, self.representative(root)))
  }

  // Every member of every initially discovered root, with the root's dense ID.
  pub fn iter_members(&self) -> impl Iterator<Item = (usize, AssetIndex)> + '_ {
    (0..self.len()).flat_map(|root| self.members(root).iter().map(move |&asset| (root, asset)))
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

  pub fn retain_active(&self, roots: &mut BitRow) {
    roots.intersect_with(self.active_roots.bits());
  }

  pub fn deactivate(&mut self, root: usize) {
    self.active_roots.set(root, false);
  }
}
