use std::{collections::HashMap, hash::Hash};

use fixedbitset::FixedBitSet;
use glob_match::glob_match;
use parcel_core::{
  Asset, AssetGraph, AssetIndex, AssetType, Bundle, BundleBehavior, BundleFlags, BundleGraph,
  Bundler, ContentType, DependencyFlags, DependencyId, DiagnosticList, Environment,
  EnvironmentFlags, ParcelOptions, Priority, SpecifierType,
};

use crate::library_bundler::LibraryBundler;

#[derive(serde::Deserialize)]
pub struct ManualSharedBundle {
  assets: Vec<String>,
  #[serde(default)]
  types: Vec<AssetType>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBundler {
  #[serde(default)]
  manual_shared_bundles: Vec<ManualSharedBundle>,
}

impl DefaultBundler {
  fn manual_shared_bundle(&self, asset: &Asset, options: &ParcelOptions) -> Option<usize> {
    let path = asset
      .loc
      .url
      .to_file_path()
      .ok()
      .map(|path| path.relative(&options.project_root));
    let Some(path) = path else {
      return None;
    };
    let path = path.to_string_lossy();

    self.manual_shared_bundles.iter().position(|b| {
      if b.types.is_empty() || b.types.contains(&asset.ty) {
        return b.assets.iter().any(|a| glob_match(a, &path));
      }

      false
    })
  }
}

#[derive(Hash, PartialEq, Eq)]
enum BundleKey<'a> {
  Default {
    reachable_roots: &'a FixedBitSet,
    context: Environment,
    packager: ContentType,
  },
  Manual {
    index: usize,
    packager: ContentType,
  },
}

impl<'a> BundleKey<'a> {
  fn stable_hash(&self, bundles: &[Bundle]) -> u64 {
    let mut hasher = xxhash_rust::xxh3::Xxh3Default::new();
    match self {
      BundleKey::Default {
        reachable_roots,
        context,
        packager,
      } => {
        0.hash(&mut hasher);
        let mut ids: Vec<u64> = reachable_roots
          .ones()
          .map(|bundle_root_index| bundles[bundle_root_index].id)
          .collect();
        ids.sort();
        ids.hash(&mut hasher);
        context.hash(&mut hasher);
        packager.hash(&mut hasher);
      }
      BundleKey::Manual { index, packager } => {
        1.hash(&mut hasher);
        index.hash(&mut hasher);
        packager.hash(&mut hasher);
      }
    }
    hasher.digest()
  }
}

impl Bundler for DefaultBundler {
  fn bundle<'a>(
    &self,
    asset_graph: AssetGraph<'a>,
    options: &ParcelOptions,
  ) -> Result<BundleGraph<'a>, DiagnosticList> {
    if asset_graph.entries.iter().all(|e| {
      asset_graph
        .asset(asset_graph.resolved_entry(e).unwrap())
        .target
        .flags
        .contains(EnvironmentFlags::IS_LIBRARY)
    }) {
      return LibraryBundler {}.bundle(asset_graph, options);
    }

    let mut bundles = Vec::<Bundle>::new();
    let mut dependency_resolutions = HashMap::new();

    // Step 1: Traverse the asset graph and find bundle roots.
    // A bundle root is created for entries, and lazy, parallel, isolated, or inline dependencies.
    let bundle_roots = BundleRoots::from_asset_graph(&asset_graph);

    // Step 2: Determine which bundle roots can synchronously reach each asset.
    let reachability = Reachability::from_bundle_roots(&asset_graph, &bundle_roots);

    let mut shared_bundles = HashMap::<BundleKey, usize>::new();
    let mut asset_index_to_bundle_index = HashMap::new();

    // Create bundles for each bundle root first.
    for (_, bundle_root_asset_index) in bundle_roots.iter() {
      let asset = &asset_graph.asset(bundle_root_asset_index);
      let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
        BundleKey::Manual {
          index,
          packager: asset.content.ty(),
        }
      } else {
        BundleKey::Default {
          reachable_roots: &reachability.reachable_roots(bundle_root_asset_index),
          context: asset.target.environment, // TODO: other environment properties?
          packager: asset.content.ty(),
        }
      };

      let bundle = Bundle {
        id: match &key {
          BundleKey::Default { .. } => asset.id_u64(&options.project_root),
          BundleKey::Manual { .. } => key.stable_hash(&bundles),
        },
        ty: asset.ty.clone(),
        target: asset.target.clone(),
        bundle_behavior: bundle_roots.bundle_behavior(bundle_root_asset_index),
        flags: if bundle_roots.is_entry(bundle_root_asset_index) {
          BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME
        } else {
          BundleFlags::empty()
        },
        dist_path: None,
        assets: Vec::new(),
        entry_assets: vec![bundle_root_asset_index],
        main_entry_asset: Some(bundle_root_asset_index),
        referenced_bundles: Vec::new(),
      };

      let bundle_index = bundles.len();
      asset_index_to_bundle_index.insert(bundle_root_asset_index, bundle_index);
      bundles.push(bundle);
      shared_bundles.insert(key, bundle_index);
    }

    // Place assets into bundles, following depth-first order.
    for (asset_index, asset, name) in asset_graph.dfs() {
      let is_bundle_root = bundle_roots.is_bundle_root(asset_index);
      let reachable_roots = reachability.reachable_roots(asset_index);
      if !is_bundle_root && reachable_roots.is_clear() {
        continue;
      }

      let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
        BundleKey::Manual {
          index,
          packager: asset.content.ty(),
        }
      } else {
        BundleKey::Default {
          reachable_roots,
          context: asset.target.environment, // TODO: other environment properties?
          packager: asset.content.ty(),
        }
      };

      let bundle_index = if let Some(bundle_index) = shared_bundles.get_mut(&key) {
        bundles[*bundle_index]
          .assets
          .push(asset_index as AssetIndex);
        *bundle_index
      } else {
        let bundle = Bundle {
          id: key.stable_hash(&bundles),
          ty: asset.ty.clone(),
          target: asset.target.clone(),
          bundle_behavior: bundle_roots.bundle_behavior(asset_index),
          flags: if bundle_roots.is_entry(asset_index) {
            BundleFlags::ENTRY | BundleFlags::NEEDS_STABLE_NAME
          } else {
            BundleFlags::empty()
          },
          dist_path: name,
          assets: vec![asset_index as AssetIndex],
          entry_assets: if is_bundle_root {
            vec![asset_index as AssetIndex]
          } else {
            Vec::new()
          },
          main_entry_asset: if is_bundle_root {
            Some(asset_index as AssetIndex)
          } else {
            None
          },
          referenced_bundles: Vec::new(),
        };

        let bundle_index = bundles.len();
        shared_bundles.insert(key, bundle_index);
        bundles.push(bundle);

        if is_bundle_root {
          asset_index_to_bundle_index.insert(asset_index, bundle_index);
        }

        bundle_index
      };

      // Each reachable root depends on this shared bundle.
      for bundle_root_index in reachable_roots.ones() {
        if bundle_root_index != bundle_index
          && !bundles[bundle_root_index]
            .referenced_bundles
            .contains(&bundle_index)
        {
          bundles[bundle_root_index]
            .referenced_bundles
            .push(bundle_index);
        }
      }
    }

    // Build a reverse map from asset index to the bundle it was placed in.
    let mut asset_to_bundle = HashMap::<AssetIndex, usize>::new();
    for (bundle_index, bundle) in bundles.iter().enumerate() {
      for asset_index in &bundle.assets {
        asset_to_bundle.insert(*asset_index, bundle_index);
      }
    }

    for (asset_index, asset, _) in asset_graph.dfs() {
      let source_bundle_index = asset_to_bundle.get(&asset_index).copied();
      for (dep_index, dep) in asset.dependencies.iter().enumerate() {
        if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
          if let Some(&bundle_index) = asset_index_to_bundle_index.get(&resolved_asset_index) {
            // A sync non-URL dep targeting a bundle root in a different JS bundle keeps its
            // Asset resolution so the runtime can resolve it via the parcelRequire chain.
            // The target bundle is added to referenced_bundles so it loads synchronously first.
            // Exclude URL-type deps and inline/isolated bundles — those use Bundle resolution
            // so the packager can compute URLs or inline content correctly.
            let is_sync_module_dep = dep.priority == Priority::Sync
              && dep.bundle_behavior == BundleBehavior::None
              && dep.specifier_type != SpecifierType::Url
              && bundles[bundle_index].bundle_behavior == BundleBehavior::None;

            if is_sync_module_dep {
              if let Some(src_bundle_index) = source_bundle_index {
                if bundle_index != src_bundle_index
                  && !bundles[src_bundle_index]
                    .referenced_bundles
                    .contains(&bundle_index)
                {
                  bundles[src_bundle_index]
                    .referenced_bundles
                    .push(bundle_index);
                }
              }
            } else {
              dependency_resolutions.insert(
                DependencyId {
                  asset: asset_index as AssetIndex,
                  dependency: dep_index,
                },
                bundle_index as u32,
              );
              if dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME) {
                bundles[bundle_index].flags |= BundleFlags::NEEDS_STABLE_NAME;
              }
            }
          }
        }
      }
    }

    // println!("{:?}", bundles);
    Ok(BundleGraph::new(
      asset_graph,
      bundles,
      dependency_resolutions,
      options.project_root,
    ))
  }
}

// Say there is 100k assets.
// 12.5k + 12.5k + 100k = 125k of memory.

struct BundleRoots {
  bundle_roots: FixedBitSet,
  entry_bundle_roots: FixedBitSet,
  bundle_behaviors: Vec<BundleBehavior>,
}

impl BundleRoots {
  pub fn from_asset_graph(asset_graph: &AssetGraph) -> BundleRoots {
    let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut entry_bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    for entry in asset_graph.entries.iter() {
      if let Some(asset) = asset_graph.resolved_entry(entry) {
        bundle_roots.insert(asset.index());
        entry_bundle_roots.insert(asset.index());
      }
    }

    // TODO: does this use too much memory?
    let mut bundle_behaviors = asset_graph
      .assets
      .iter()
      .map(|asset| asset.bundle_behavior)
      .collect::<Vec<_>>();

    // Use dfs so we only process live assets, not deleted assets from a previous build.
    for (asset_index, asset, _) in asset_graph.dfs() {
      if bundle_behaviors[asset_index.index()] != BundleBehavior::None {
        bundle_roots.insert(asset_index.index());
      }

      for dep_index in 0..asset.dependencies.len() {
        let dep = &asset_graph.asset(asset_index).dependencies[dep_index];
        if dep.bundle_behavior != BundleBehavior::None || dep.priority != Priority::Sync {
          if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
            let bundle_behavior = dep.bundle_behavior;
            bundle_roots.insert(resolved_asset_index.index());
            let target_bundle_behavior = &mut bundle_behaviors[resolved_asset_index.index()];
            if bundle_behavior != BundleBehavior::None
              && *target_bundle_behavior == BundleBehavior::None
            {
              *target_bundle_behavior = bundle_behavior;
            }
          }
        }
      }
    }

    BundleRoots {
      bundle_roots,
      entry_bundle_roots,
      bundle_behaviors,
    }
  }

  pub fn len(&self) -> usize {
    self.bundle_roots.count_ones(..)
  }

  pub fn iter(&self) -> impl Iterator<Item = (usize, AssetIndex)> {
    self
      .bundle_roots
      .ones()
      .enumerate()
      .map(|(i, asset)| (i, AssetIndex::from_index(asset)))
  }

  pub fn is_bundle_root(&self, id: AssetIndex) -> bool {
    self.bundle_roots.contains(id.index())
  }

  pub fn is_entry(&self, id: AssetIndex) -> bool {
    self.entry_bundle_roots.contains(id.index())
  }

  pub fn bundle_behavior(&self, id: AssetIndex) -> BundleBehavior {
    self.bundle_behaviors[id.index()]
  }
}

struct Reachability {
  // Assets in the same SCC share the set of bundle roots that can reach them.
  // Unreachable assets map to a shared trailing empty component.
  asset_components: Vec<u32>,
  reachable_roots: Vec<FixedBitSet>,
}

impl Reachability {
  pub fn from_bundle_roots(asset_graph: &AssetGraph, bundle_roots: &BundleRoots) -> Reachability {
    let asset_count = asset_graph.assets.len();
    let mut asset_components = vec![u32::MAX; asset_count];
    let mut discovery = vec![u32::MAX; asset_count];
    let mut low = vec![0u32; asset_count];
    let mut stack = Vec::new();
    let mut frames = Vec::new();
    let mut next_index = 0u32;
    // Members of each component occupy a contiguous range in this flat array.
    let mut members = Vec::new();
    let mut offsets = vec![0u32];
    // Non-root edge targets, recorded once per asset at discovery. Enumerating
    // edges scans symbol tables per dependency, so the propagation pass below
    // replays this array rather than enumerating a second time. The targets of
    // the asset with discovery index d occupy
    // edge_targets[edge_offsets[d]..edge_offsets[d + 1]].
    let mut edge_targets: Vec<u32> = Vec::new();
    let mut edge_offsets = vec![0u32];

    // Iterative Tarjan: only visit assets reachable from roots, and never
    // traverse an edge into a bundle root. Explicit frames with cursors into
    // edge_targets avoid recursion on deep graphs.
    for (_, root) in bundle_roots.iter() {
      discovery[root.index()] = next_index;
      low[root.index()] = next_index;
      next_index += 1;
      stack.push(root.0);
      frames.push((root.0, edge_targets.len() as u32));
      edge_targets.extend(
        asset_graph
          .resolved_dependencies(asset_graph.asset(root))
          .filter(|&t| !bundle_roots.is_bundle_root(t))
          .map(|t| t.0),
      );
      edge_offsets.push(edge_targets.len() as u32);
      while let Some((asset, cursor)) = frames.last_mut() {
        let asset = *asset as usize;
        if *cursor < edge_offsets[discovery[asset] as usize + 1] {
          let target = edge_targets[*cursor as usize];
          *cursor += 1;
          if discovery[target as usize] == u32::MAX {
            discovery[target as usize] = next_index;
            low[target as usize] = next_index;
            next_index += 1;
            stack.push(target);
            frames.push((target, edge_targets.len() as u32));
            edge_targets.extend(
              asset_graph
                .resolved_dependencies(asset_graph.asset(AssetIndex(target)))
                .filter(|&t| !bundle_roots.is_bundle_root(t))
                .map(|t| t.0),
            );
            edge_offsets.push(edge_targets.len() as u32);
          } else if asset_components[target as usize] == u32::MAX {
            low[asset] = low[asset].min(discovery[target as usize]);
          }
        } else {
          frames.pop();
          if low[asset] == discovery[asset] {
            let component = offsets.len() as u32 - 1;
            loop {
              let member = stack.pop().unwrap();
              asset_components[member as usize] = component;
              members.push(member);
              if member as usize == asset {
                break;
              }
            }
            offsets.push(members.len() as u32);
          }
          if let Some((parent, _)) = frames.last() {
            let parent = *parent as usize;
            low[parent] = low[parent].min(low[asset]);
          }
        }
      }
    }
    drop(low);
    drop(stack);
    drop(frames);

    // One bitset per component, plus a trailing empty component shared by all
    // unreachable assets.
    let component_count = offsets.len() - 1;
    let mut reachable_roots =
      vec![FixedBitSet::with_capacity(bundle_roots.len()); component_count + 1];
    for (root_index, root) in bundle_roots.iter() {
      reachable_roots[asset_components[root.index()] as usize].insert(root_index);
    }

    // Tarjan emits components in reverse topological order. Replay the recorded
    // edges to propagate through the implicit condensation DAG.
    let mut seen = vec![u32::MAX; component_count];
    for component in (0..component_count).rev() {
      let (targets, rest) = reachable_roots.split_at_mut(component);
      let source = &rest[0];
      for &member in &members[offsets[component] as usize..offsets[component + 1] as usize] {
        let d = discovery[member as usize] as usize;
        for &target in &edge_targets[edge_offsets[d] as usize..edge_offsets[d + 1] as usize] {
          let target_component = asset_components[target as usize] as usize;
          if target_component != component && seen[target_component] != component as u32 {
            debug_assert!(target_component < component);
            seen[target_component] = component as u32;
            targets[target_component].union_with(source);
          }
        }
      }
    }

    Reachability {
      asset_components,
      reachable_roots,
    }
  }

  pub fn reachable_roots(&self, index: AssetIndex) -> &FixedBitSet {
    let index = self.asset_components[index.index()] as usize;
    &self.reachable_roots[index.min(self.reachable_roots.len() - 1)]
  }
}
