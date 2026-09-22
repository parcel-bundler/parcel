use std::collections::HashMap;

use fixedbitset::FixedBitSet;

use super::bit_matrix::{AsBitRow, BitRow};
use parcel_core::{
  AssetGraph, AssetIndex, AssetType, BundleBehavior, DependencyFlags, Priority, SpecifierType,
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
  // Dense root ID -> the root it loads as. Lazy targets only ever imported
  // together, `Promise.all([import('a'), import('b')])`, from the same places,
  // are one loading event: they share a canonical root, and every consumer
  // of the dense ID space (reachability, availability, internalization) sees
  // only the canonical one. Members remain addressable by their own asset.
  canonical: Vec<u32>,
  // Whether any root is a member of another.
  grouped: bool,
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

    let mut roots = BundleRoots {
      canonical: (0..root_assets.len() as u32).collect(),
      grouped: false,
      root_assets,
      root_indices,
      active_roots,
      entry_roots,
      mandatory_roots,
      bundle_behaviors,
    };
    roots.group_concurrent(asset_graph);
    roots
  }

  // Merge roots whose every incoming reference is a concurrent import, and
  // whose sets of importing (asset, group) sites are identical: nothing ever
  // loads one without the others. Anything reached any other way stays its
  // own root, since merging would push the rest into a context that did not
  // ask for it.
  fn group_concurrent(&mut self, asset_graph: &AssetGraph) {
    let mut sites: Vec<Vec<(u32, u32)>> = vec![Vec::new(); self.root_assets.len()];
    let mut independent = self.mandatory_roots.clone();
    for (source, asset, _) in asset_graph.dfs() {
      for dep in &asset.dependencies {
        let Some((target, _)) = asset_graph.resolved_asset(dep) else {
          continue;
        };
        let Some(root) = self.root_index(target) else {
          continue;
        };
        if dep.concurrent_group != 0
          && dep.priority == Priority::Lazy
          && dep.specifier_type != SpecifierType::Url
          && dep.bundle_behavior == BundleBehavior::None
        {
          sites[root].push((source.0, dep.concurrent_group));
        } else {
          independent.insert(root);
        }
      }
    }
    let mut groups: HashMap<Vec<(u32, u32)>, Vec<usize>> = HashMap::new();
    for (root, sites) in sites.iter_mut().enumerate() {
      let asset = asset_graph.asset(self.root_assets[root]);
      if sites.is_empty()
        || independent.contains(root)
        || asset.ty != AssetType::Js
        || self.bundle_behaviors[root] != BundleBehavior::None
      {
        continue;
      }
      sites.sort_unstable();
      sites.dedup();
      groups.entry(std::mem::take(sites)).or_default().push(root);
    }
    for members in groups.into_values() {
      // Dense IDs follow asset order, so the first member is the canonical root.
      let canonical = members[0];
      let environment = asset_graph
        .asset(self.root_assets[canonical])
        .target
        .environment;
      for &member in &members[1..] {
        if asset_graph
          .asset(self.root_assets[member])
          .target
          .environment
          == environment
        {
          self.canonical[member] = canonical as u32;
          self.grouped = true;
        }
      }
    }
  }

  // The root a dense root loads as: itself, or the canonical root of its group.
  pub fn canonical(&self, root: usize) -> usize {
    self.canonical[root] as usize
  }

  pub fn is_canonical(&self, root: usize) -> bool {
    self.canonical[root] as usize == root
  }

  pub fn has_groups(&self) -> bool {
    self.grouped
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

  pub fn retain_active(&self, roots: &mut BitRow) {
    roots.intersect_with(self.active_roots.bits());
  }

  // Deactivate a root and, through it, every member of its group.
  pub fn deactivate(&mut self, root: usize) {
    let canonical = self.canonical[root];
    for member in 0..self.canonical.len() {
      if self.canonical[member] == canonical {
        self.active_roots.set(member, false);
      }
    }
  }
}
