use std::{
  collections::{HashMap, VecDeque},
  hash::Hash,
};

use fixedbitset::FixedBitSet;
use glob_match::glob_match;
use parcel_core::{
  Asset, AssetGraph, AssetIndex, AssetType, Bundle, BundleBehavior, BundleFlags, BundleGraph,
  BundleGraphDependencyResolution, Bundler, ContentType, Dependency, DependencyFlags, DependencyId,
  DiagnosticList, Environment, EnvironmentFlags, ImportType, ParcelOptions, Priority, SourceType,
  SpecifierType,
};

use crate::library_bundler::LibraryBundler;

#[cfg(test)]
mod tests;

#[derive(serde::Deserialize)]
pub struct ManualSharedBundle {
  /// Project-relative glob patterns selecting assets for this manual bundle.
  assets: Vec<String>,
  /// Asset types to match. An empty list allows every type.
  #[serde(default)]
  types: Vec<AssetType>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBundler {
  /// Manual grouping rules, checked in order so the first matching rule wins.
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
    // Dense logical roots requiring these assets after availability filtering.
    reachable_roots: &'a FixedBitSet,
    // Runtime context used to keep incompatible module registries separate.
    context: Environment,
    // Content implementation responsible for packaging these assets together.
    packager: ContentType,
  },
  Manual {
    // Index of the first matching manual grouping rule.
    index: usize,
    // One output per packager, even when the rule selects several asset types.
    packager: ContentType,
  },
}

impl<'a> BundleKey<'a> {
  fn stable_hash(&self, root_ids: &[u64]) -> u64 {
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
          .map(|bundle_root_index| root_ids[bundle_root_index])
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
    let mut bundle_roots = BundleRoots::from_asset_graph(&asset_graph);

    // Explicit manual bundles keep their loading boundaries and grouping policy.
    let mut manual_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    for (_, root) in bundle_roots.iter() {
      if self
        .manual_shared_bundle(asset_graph.asset(root), options)
        .is_some()
      {
        manual_roots.insert(root.index());
      }
    }

    // The synchronous graph and original root universe remain fixed while
    // internalization only deactivates loading contexts. Keep the initial class
    // partition (a valid finer partition after roots disappear) and reuse all
    // topology and solver allocations across rounds.
    let reachability = Reachability::from_bundle_roots(&asset_graph, &bundle_roots);
    let availability =
      AvailabilityGraph::from_asset_graph(&asset_graph, &bundle_roots, &reachability);
    let mut availability_state = AvailabilityState::new(&availability);
    let mut internalization = Internalization::new(
      &asset_graph,
      &bundle_roots,
      &reachability,
      &availability,
      &manual_roots,
    );
    let needed_roots = loop {
      let available = availability_state.solve(&availability, &bundle_roots.active_roots);
      if !internalization.run(
        &mut bundle_roots,
        &reachability,
        &availability,
        available,
        &mut dependency_resolutions,
      ) {
        break availability.needed_roots(reachability, &bundle_roots, available);
      }
    };

    // Hash logical roots, independently of their eventual physical bundle indices.
    let root_assets = bundle_roots.root_assets.clone();
    let root_ids: Vec<_> = root_assets
      .iter()
      .map(|&root| asset_graph.asset(root).id_u64(&options.project_root))
      .collect();

    let mut shared_bundles = HashMap::<BundleKey, usize>::new();
    let mut asset_index_to_bundle_index = HashMap::new();
    // Dense logical root -> loadable bundle (possibly an entry facade).
    let mut root_to_bundle = vec![0; bundle_roots.len()];
    // Canonical content bundle -> non-JS entry bundles that must package the
    // same assets because their packager cannot use empty execution facades.
    let mut mirrored_bundles = HashMap::<usize, Vec<usize>>::new();

    // Create bundles for each bundle root first.
    for (root_index, bundle_root_asset_index) in bundle_roots.iter() {
      let asset = &asset_graph.asset(bundle_root_asset_index);
      let key = if let Some(index) = self.manual_shared_bundle(asset, options) {
        BundleKey::Manual {
          index,
          packager: asset.content.ty(),
        }
      } else {
        BundleKey::Default {
          reachable_roots: needed_roots.reachable_roots(bundle_root_asset_index),
          context: asset.target.environment, // TODO: other environment properties?
          packager: asset.content.ty(),
        }
      };

      let bundle = Bundle {
        id: match &key {
          BundleKey::Default { .. } => asset.id_u64(&options.project_root),
          BundleKey::Manual { .. } => key.stable_hash(&root_ids),
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

      let bundle_index = if let Some(&existing) = shared_bundles.get(&key) {
        // The JS packager supports separating loading from execution. Therefore, if two entries share the
        // same bundle we can convert this into a shared bundle and add an empty entry facade that executes
        // the corresponding main entry module in the shared bundle.
        if asset.ty == AssetType::Js {
          if let Some(previous_root) = bundles[existing].main_entry_asset.take() {
            bundles[existing].entry_assets.clear();
            bundles[existing].id = key.stable_hash(&root_ids);
            if bundle_roots.mandatory_roots.contains(previous_root.index()) {
              let facade = Bundle {
                id: asset_graph
                  .asset(previous_root)
                  .id_u64(&options.project_root),
                ty: bundles[existing].ty.clone(),
                target: bundles[existing].target.clone(),
                bundle_behavior: bundles[existing].bundle_behavior,
                flags: bundles[existing].flags,
                dist_path: None,
                assets: Vec::new(),
                main_entry_asset: Some(previous_root),
                entry_assets: vec![previous_root],
                referenced_bundles: vec![existing],
              };
              let facade_index = bundles.len();
              bundles.push(facade);
              let previous_index = root_assets.binary_search(&previous_root).unwrap();
              root_to_bundle[previous_index] = facade_index;
              asset_index_to_bundle_index.insert(previous_root, facade_index);
            }
            bundles[existing].flags = BundleFlags::empty();
          }

          if bundle_roots
            .mandatory_roots
            .contains(bundle_root_asset_index.index())
          {
            let mut facade = bundle;
            facade.id = asset.id_u64(&options.project_root);
            facade.referenced_bundles.push(existing);
            let facade_index = bundles.len();
            bundles.push(facade);
            facade_index
          } else {
            existing
          }
        } else {
          let mirror = bundles.len();
          bundles.push(bundle);
          mirrored_bundles.entry(existing).or_default().push(mirror);
          mirror
        }
      } else {
        let bundle_index = bundles.len();
        bundles.push(bundle);
        shared_bundles.insert(key, bundle_index);
        bundle_index
      };
      root_to_bundle[root_index] = bundle_index;
      asset_index_to_bundle_index.insert(bundle_root_asset_index, bundle_index);
    }

    // Place assets into bundles, following depth-first order.
    for (asset_index, asset, name) in asset_graph.dfs() {
      let is_bundle_root = bundle_roots.is_bundle_root(asset_index);
      let reachable_roots = needed_roots.reachable_roots(asset_index);
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
        if let Some(mirrors) = mirrored_bundles.get(bundle_index) {
          for &mirror in mirrors {
            bundles[mirror].assets.push(asset_index as AssetIndex);
          }
        }
        *bundle_index
      } else {
        let bundle = Bundle {
          id: key.stable_hash(&root_ids),
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
        let bundle_root_index = root_to_bundle[bundle_root_index];
        if bundle_root_index != bundle_index
          && !mirrored_bundles
            .get(&bundle_index)
            .is_some_and(|mirrors| mirrors.contains(&bundle_root_index))
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
        asset_to_bundle.entry(*asset_index).or_insert(bundle_index);
      }
    }

    for (asset_index, asset, _) in asset_graph.dfs() {
      let source_bundle_index = asset_to_bundle.get(&asset_index).copied();
      for (dep_index, dep) in asset.dependencies.iter().enumerate() {
        let dependency_id = DependencyId {
          asset: asset_index,
          dependency: dep_index,
        };

        if dependency_resolutions.contains_key(&dependency_id) {
          continue;
        }

        if let Some((resolved_asset_index, _)) = asset_graph.resolved_asset(dep) {
          // Mirrored non-JS entries contain the same complete asset set as
          // their canonical owner. Keep these resolutions intra-bundle so each
          // packager can inline a synchronous cycle independently.
          if source_bundle_index
            .is_some_and(|source| asset_to_bundle.get(&resolved_asset_index) == Some(&source))
          {
            continue;
          }
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
              let bundle_index = asset_to_bundle[&resolved_asset_index];
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
                BundleGraphDependencyResolution::Bundle {
                  bundle_index: bundle_index as u32,
                  asset_index: resolved_asset_index,
                },
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

struct BundleRoots {
  // Dense root ID -> root asset. IDs are assigned once in asset-index order.
  root_assets: Vec<AssetIndex>,
  // Asset index -> dense root ID, or u32::MAX for assets that were never roots.
  root_indices: Vec<u32>,
  // Dense root IDs still requiring independently loadable bundles.
  active_roots: FixedBitSet,
  // Asset-indexed subset of roots that are directly entered and cannot inherit availability.
  entry_bundle_roots: FixedBitSet,
  // Roots with a reason other than a lazy module import.
  // Internalizing imports must not remove these externally observable outputs.
  mandatory_roots: FixedBitSet,
  // Effective behavior per asset, combining asset metadata with incoming dependency overrides.
  bundle_behaviors: Vec<BundleBehavior>,
}

impl BundleRoots {
  pub fn from_asset_graph(asset_graph: &AssetGraph) -> BundleRoots {
    let mut bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut entry_bundle_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    let mut mandatory_roots = FixedBitSet::with_capacity(asset_graph.assets.len());
    for entry in asset_graph.entries.iter() {
      if let Some(asset) = asset_graph.resolved_entry(entry) {
        bundle_roots.insert(asset.index());
        entry_bundle_roots.insert(asset.index());
        mandatory_roots.insert(asset.index());
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
        mandatory_roots.insert(asset_index.index());
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
              mandatory_roots.insert(resolved_asset_index.index());
            }
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

    let root_assets: Vec<_> = bundle_roots.ones().map(AssetIndex::from_index).collect();
    let mut root_indices = vec![u32::MAX; asset_graph.assets.len()];
    for (root, asset) in root_assets.iter().enumerate() {
      root_indices[asset.index()] = root as u32;
    }
    let mut active_roots = FixedBitSet::with_capacity(root_assets.len());
    active_roots.insert_range(..);

    BundleRoots {
      root_assets,
      root_indices,
      active_roots,
      entry_bundle_roots,
      mandatory_roots,
      bundle_behaviors,
    }
  }

  // Number of stable dense root IDs, including roots removed by internalization.
  pub fn len(&self) -> usize {
    self.root_assets.len()
  }

  // Active roots with their stable dense IDs.
  pub fn iter(&self) -> impl Iterator<Item = (usize, AssetIndex)> {
    self
      .active_roots
      .ones()
      .map(|root| (root, self.root_assets[root]))
  }

  // Every initially discovered root with its stable dense ID.
  fn iter_all(&self) -> impl Iterator<Item = (usize, AssetIndex)> + '_ {
    self.root_assets.iter().copied().enumerate()
  }

  fn root_index(&self, asset: AssetIndex) -> Option<usize> {
    let root = self.root_indices[asset.index()];
    (root != u32::MAX).then_some(root as usize)
  }

  pub fn is_bundle_root(&self, id: AssetIndex) -> bool {
    self
      .root_index(id)
      .is_some_and(|root| self.active_roots.contains(root))
  }

  fn is_original_root(&self, id: AssetIndex) -> bool {
    self.root_indices[id.index()] != u32::MAX
  }

  pub fn is_entry(&self, id: AssetIndex) -> bool {
    self.entry_bundle_roots.contains(id.index())
  }

  pub fn bundle_behavior(&self, id: AssetIndex) -> BundleBehavior {
    self.bundle_behaviors[id.index()]
  }
}

// Use dependency metadata rather than root membership: a demoted async target
// is placed with its synchronous providers, never pulled into its async importer.
fn synchronous_dependencies<'a>(
  graph: &'a AssetGraph,
  roots: &'a BundleRoots,
  asset: &'a Asset,
) -> impl Iterator<Item = AssetIndex> + 'a {
  graph
    .resolved_dependencies_with_indices(asset)
    .filter_map(move |(index, target)| {
      let dep = &asset.dependencies[index];
      // Cross-environment non-roots (CSS and RSC references) still need
      // placement through their importer. Only explicit roots reset loading.
      is_sync_dep(graph, roots, asset, dep, target).then_some(target)
    })
}

fn is_sync_dep(
  graph: &AssetGraph,
  roots: &BundleRoots,
  asset: &Asset,
  dep: &Dependency,
  target: AssetIndex,
) -> bool {
  dep.priority == Priority::Sync
    && dep.bundle_behavior == BundleBehavior::None
    && roots.bundle_behavior(target) == BundleBehavior::None
    && (!roots.is_original_root(target)
      || asset.target.environment == graph.asset(target).target.environment)
}

struct Reachability {
  // Asset index -> class ID.
  // SCCs with identical reachable-root sets form a "class". Every asset in
  // a class is generated together by availability's synchronous root closures.
  // Unreachable assets map to the shared empty class.
  asset_classes: Vec<u32>,
  // Class ID -> bitset of dense root indices. Initially these are synchronous
  // reaching roots. `needed_roots` later removes roots with guaranteed availability.
  // Classes remain based on the original sets, so filtered sets can be equal.
  reachable_roots: Vec<FixedBitSet>,
}

impl Reachability {
  pub fn from_bundle_roots(asset_graph: &AssetGraph, bundle_roots: &BundleRoots) -> Reachability {
    let asset_count = asset_graph.assets.len();
    // Asset -> completed SCC, or u32::MAX until assigned (also used for dead assets).
    let mut asset_components = vec![u32::MAX; asset_count];
    // Asset -> DFS discovery number, or u32::MAX if it has not been visited.
    let mut discovery = vec![u32::MAX; asset_count];
    // Tarjan low-link values identify the earliest active discovery reachable from each asset.
    let mut low = vec![0u32; asset_count];
    // Discovered assets awaiting assignment to a completed SCC.
    let mut stack = Vec::new();
    // Explicit DFS call stack: (asset index, next position in edge_targets).
    let mut frames: Vec<(u32, u32)> = Vec::new();
    // Discovery number assigned to the next newly visited asset.
    let mut next_index = 0u32;
    // Members of each component occupy a contiguous range in this flat array.
    let mut members = Vec::new();
    // SCC c owns members[offsets[c]..offsets[c + 1]], including a trailing end offset.
    let mut offsets = vec![0u32];
    // Synchronous edge targets, recorded once per asset at discovery. Enumerating
    // edges scans symbol tables per dependency, so the propagation pass below
    // replays this array rather than enumerating a second time. The targets of
    // the asset with discovery index d occupy
    // edge_targets[edge_offsets[d]..edge_offsets[d + 1]].
    let mut edge_targets: Vec<u32> = Vec::new();
    let mut edge_offsets = vec![0u32];

    // Iterative Tarjan: ordinary synchronous edges cross root boundaries too.
    // Lazy edges stay excluded even after their target root is removed.
    // Explicit frames with cursors into edge_targets avoid recursion on deep graphs.
    for (_, root) in bundle_roots.iter_all() {
      if discovery[root.index()] != u32::MAX {
        continue;
      }

      discovery[root.index()] = next_index;
      low[root.index()] = next_index;
      next_index += 1;
      stack.push(root.0);
      frames.push((root.0, edge_targets.len() as u32));
      edge_targets.extend(
        synchronous_dependencies(asset_graph, bundle_roots, asset_graph.asset(root)).map(|t| t.0),
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
              synchronous_dependencies(
                asset_graph,
                bundle_roots,
                asset_graph.asset(AssetIndex(target)),
              )
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
    for (root_index, root) in bundle_roots.iter_all() {
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

    drop((
      discovery,
      members,
      offsets,
      edge_targets,
      edge_offsets,
      seen,
    ));
    Self::from_components(asset_components, reachable_roots)
  }

  fn from_components(mut asset_classes: Vec<u32>, reachable_roots: Vec<FixedBitSet>) -> Self {
    let component_count = reachable_roots.len() - 1;
    // Intern equal sets, including equal sets from distinct SCCs. Move the
    // bitsets into the table so this does not copy the reachability matrix.
    let mut classes = HashMap::new();
    // Temporary SCC ID -> canonical class ID, including the trailing empty SCC.
    let component_classes: Vec<u32> = reachable_roots
      .into_iter()
      .map(|roots| {
        let next = classes.len() as u32;
        *classes.entry(roots).or_insert(next)
      })
      .collect();
    for component in &mut asset_classes {
      *component = component_classes[(*component as usize).min(component_count)];
    }
    // Reorder the interned sets by class ID so subsequent queries need no hash lookup.
    let mut reachable_roots = vec![FixedBitSet::new(); classes.len()];
    for (roots, class) in classes {
      reachable_roots[class as usize] = roots;
    }

    Reachability {
      asset_classes,
      reachable_roots,
    }
  }

  pub fn reachable_roots(&self, index: AssetIndex) -> &FixedBitSet {
    &self.reachable_roots[self.class(index)]
  }

  fn class(&self, index: AssetIndex) -> usize {
    self.asset_classes[index.index()] as usize
  }
}

#[derive(Clone, Copy, Debug)]
enum AvailabilityEdgeKind {
  // The target loads before its importer. Only the importer's IN is safe.
  Sync,
  // The target can use its parent's IN plus the parent's synchronous asset classes.
  Lazy,
  // Ordered, non-isolated parallel occurrences in the same loading context.
  Parallel,
}

#[derive(Clone, Copy, Debug)]
struct AvailabilityEdge {
  // Dense destination root index, not an AssetIndex or a reachability class ID.
  root: u32,
  // Selects which parent facts and preceding parallel occurrences reach this target.
  kind: AvailabilityEdgeKind,
}

struct AvailabilityGraph {
  // Root index -> bitset of synchronously loaded class IDs (the transpose of
  // original reachability). Immutable throughout analysis and requirement filtering.
  synchronous: Vec<FixedBitSet>,
  // Root-indexed set whose IN stays empty: entries, inline/isolated roots,
  // environment boundaries, and roots without a live path from these boundaries.
  boundaries: FixedBitSet,
  // Each group is one asset's ordered boundary dependencies. Store it only once,
  // even when many roots reach that asset. Groups are indexed by source class.
  // Class c owns groups in [offsets[c], offsets[c + 1]). The last offset is a sentinel.
  class_group_offsets: Vec<u32>,
  // Group g owns edges[group_edge_offsets[g]..group_edge_offsets[g + 1]].
  // Keeping groups separate prevents prefixes leaking between source assets in one class.
  group_edge_offsets: Vec<u32>,
  // Flat ordered occurrence lists. A shared source's edges are stored once,
  // rather than expanded into a separate list for every root that reaches it.
  edges: Vec<AvailabilityEdge>,
}

struct AvailabilityState {
  // Reused root-major IN matrix. Rows are reset in place before each round.
  available: Vec<FixedBitSet>,
  // Reused worklist and membership set for the descending must analysis.
  queue: VecDeque<usize>,
  queued: FixedBitSet,
  // Scratch rows for the current IN, OUT, and ordered parallel prefix.
  input: FixedBitSet,
  output: FixedBitSet,
  parallel: FixedBitSet,
}

impl AvailabilityState {
  fn new(graph: &AvailabilityGraph) -> Self {
    let root_count = graph.synchronous.len();
    let class_count = graph.class_group_offsets.len() - 1;
    Self {
      available: vec![FixedBitSet::with_capacity(class_count); root_count],
      queue: VecDeque::with_capacity(root_count),
      queued: FixedBitSet::with_capacity(root_count),
      input: FixedBitSet::with_capacity(class_count),
      output: FixedBitSet::with_capacity(class_count),
      parallel: FixedBitSet::with_capacity(class_count),
    }
  }

  fn solve<'a>(
    &'a mut self,
    graph: &AvailabilityGraph,
    active_roots: &FixedBitSet,
  ) -> &'a [FixedBitSet] {
    self.queue.clear();
    self.queued.clear();

    // TOP is the universe of classes. Reinitialize the existing allocations;
    // inactive roots have no IN row and no outgoing loading occurrences.
    for root in 0..self.available.len() {
      self.available[root].clear();
      if active_roots.contains(root) {
        if !graph.boundaries.contains(root) {
          self.available[root].insert_range(..);
        }
        self.queue.push_back(root);
        self.queued.insert(root);
      }
    }

    while let Some(root) = self.queue.pop_front() {
      self.queued.set(root, false);
      // Snapshot once: self edges may shrink this root during the scan.
      self.input.clone_from(&self.available[root]);
      self.output.clone_from(&self.input);
      self.output.union_with(&graph.synchronous[root]);

      for class in graph.synchronous[root].ones() {
        for group in graph.class_group_offsets[class]..graph.class_group_offsets[class + 1] {
          self.parallel.clone_from(&self.output);
          for edge in &graph.edges[graph.group_edge_offsets[group as usize] as usize
            ..graph.group_edge_offsets[group as usize + 1] as usize]
          {
            // An edge into a removed root no longer represents an independent
            // loading occurrence. Its source groups are already generated by
            // each surviving root that synchronously reaches their assets.
            let target = edge.root as usize;
            if !active_roots.contains(target) {
              continue;
            }

            let contribution = match edge.kind {
              AvailabilityEdgeKind::Sync => &self.input,
              AvailabilityEdgeKind::Lazy => &self.output,
              AvailabilityEdgeKind::Parallel => &self.parallel,
            };

            if !graph.boundaries.contains(target)
              && intersect_changed(&mut self.available[target], contribution)
              && !self.queued.put(target)
            {
              self.queue.push_back(target);
            }

            if matches!(edge.kind, AvailabilityEdgeKind::Parallel)
              && !graph.boundaries.contains(target)
            {
              self.parallel.union_with(&graph.synchronous[target]);
            }
          }
        }
      }
    }

    &self.available
  }
}

struct InternalizationCandidate {
  // Global dependency override written when every active context supplies the target.
  dependency: DependencyId,
  // Reachability class containing the importer.
  source_class: u32,
  // Dense root whose independently loaded bundle this dependency currently requires.
  target_root: u32,
  // Asset and class required by the eventual Internalized resolution.
  target_asset: AssetIndex,
  target_class: u32,
  // Importer's runtime environment, checked against every active loading context.
  environment: Environment,
  // A context that failed in the previous round, checked first next time.
  failed_context: u32,
  // Prevents reconsidering and recounting a dependency after it was internalized.
  internalized: bool,
}

struct Internalization {
  // Ordinary lazy JavaScript dependencies that may become internalized.
  candidates: Vec<InternalizationCandidate>,
  // Dense root -> lazy loading causes not yet internalized. Ineligible causes
  // remain counted and therefore keep their target roots active.
  remaining_causes: Vec<u32>,
  // Dense root -> environment of its synchronously loaded module registry.
  root_environments: Vec<Environment>,
}

impl Internalization {
  fn new(
    graph: &AssetGraph,
    roots: &BundleRoots,
    reachability: &Reachability,
    availability: &AvailabilityGraph,
    manual_roots: &FixedBitSet,
  ) -> Self {
    // A JS module's presence alone does not prove its CSS/parallel resources
    // loaded. Compute this once because the synchronous topology is immutable.
    let mut resource_classes = FixedBitSet::with_capacity(reachability.reachable_roots.len());
    for (source, asset, _) in graph.dfs() {
      if asset.ty != AssetType::Js
        || graph
          .resolved_dependencies_with_indices(asset)
          .any(|(index, target)| {
            let dep = &asset.dependencies[index];
            // Lazy JavaScript dependencies are the candidates being optimized;
            // they do not represent resources that must accompany the target.
            dep.priority != Priority::Lazy
              && (dep.priority == Priority::Parallel
                || dep.bundle_behavior != BundleBehavior::None
                || roots.bundle_behavior(target) != BundleBehavior::None
                || asset.target.environment != graph.asset(target).target.environment)
          })
      {
        resource_classes.insert(reachability.class(source));
      }
    }

    // Root eligibility and environments are stable even when the root is deactivated.
    let mut eligible_roots = FixedBitSet::with_capacity(roots.len());
    let root_environments: Vec<_> = roots
      .iter_all()
      .map(|(_, asset)| graph.asset(asset).target.environment)
      .collect();
    for (root, asset) in roots.iter_all() {
      if roots.bundle_behavior(asset) == BundleBehavior::None
        && !manual_roots.contains(asset.index())
        && availability.synchronous[root].is_disjoint(&resource_classes)
      {
        eligible_roots.insert(root);
      }
    }

    let mut remaining_causes = vec![0u32; roots.len()];
    let mut candidates = Vec::new();
    for (source, asset, _) in graph.dfs() {
      for (dependency, dep) in asset.dependencies.iter().enumerate() {
        if dep.priority != Priority::Lazy {
          continue;
        }
        let Some((target, target_asset)) = graph.resolved_asset(dep) else {
          continue;
        };
        let Some(target_root) = roots.root_index(target) else {
          continue;
        };
        remaining_causes[target_root] += 1;

        if asset.ty != AssetType::Js
          || asset.target.source_type != SourceType::Module
          || dep.specifier_type == SpecifierType::Url
          || dep.import_type != ImportType::JavaScript
          || dep.bundle_behavior != BundleBehavior::None
          || !eligible_roots.contains(target_root)
          || target_asset.target.source_type != SourceType::Module
          || asset.target.environment != target_asset.target.environment
        {
          continue;
        }

        candidates.push(InternalizationCandidate {
          dependency: DependencyId {
            asset: source,
            dependency,
          },
          source_class: reachability.class(source) as u32,
          target_root: target_root as u32,
          target_asset: target,
          target_class: reachability.class(target) as u32,
          environment: asset.target.environment,
          failed_context: u32::MAX,
          internalized: false,
        });
      }
    }

    Self {
      candidates,
      remaining_causes,
      root_environments,
    }
  }

  fn run(
    &mut self,
    roots: &mut BundleRoots,
    reachability: &Reachability,
    availability: &AvailabilityGraph,
    available: &[FixedBitSet],
    resolutions: &mut HashMap<DependencyId, BundleGraphDependencyResolution>,
  ) -> bool {
    for candidate in &mut self.candidates {
      if candidate.internalized {
        continue;
      }

      let contexts = &reachability.reachable_roots[candidate.source_class as usize];
      let target_class = candidate.target_class as usize;
      let fails = |root: usize| {
        self.root_environments[root] != candidate.environment
          || (!available[root].contains(target_class)
            && !availability.synchronous[root].contains(target_class))
      };

      // Most rejected candidates fail for the same context on every round.
      let previous = candidate.failed_context as usize;
      if candidate.failed_context != u32::MAX
        && roots.active_roots.contains(previous)
        && contexts.contains(previous)
        && fails(previous)
      {
        continue;
      }

      let mut has_context = false;
      let mut failure = None;
      for root in contexts.ones() {
        if !roots.active_roots.contains(root) {
          continue;
        }
        has_context = true;
        if fails(root) {
          failure = Some(root);
          break;
        }
      }
      if let Some(root) = failure {
        candidate.failed_context = root as u32;
        continue;
      }
      if !has_context {
        continue;
      }

      candidate.internalized = true;
      candidate.failed_context = u32::MAX;
      resolutions.insert(
        candidate.dependency,
        BundleGraphDependencyResolution::Internalized(candidate.target_asset),
      );
      self.remaining_causes[candidate.target_root as usize] -= 1;
    }

    let mut removed = false;
    for root in 0..roots.len() {
      if !roots.active_roots.contains(root) {
        continue;
      }
      let asset = roots.root_assets[root];
      if self.remaining_causes[root] == 0 && !roots.mandatory_roots.contains(asset.index()) {
        roots.active_roots.set(root, false);
        removed = true;
      }
    }
    removed
  }
}

impl AvailabilityGraph {
  fn from_asset_graph(
    asset_graph: &AssetGraph,
    roots: &BundleRoots,
    reachability: &Reachability,
  ) -> Self {
    let root_count = roots.len();

    // Roots whose availability must be reset regardless of their incoming dependencies.
    let mut boundaries = FixedBitSet::with_capacity(root_count);
    for (r, asset) in roots.iter_all() {
      if roots.is_entry(asset) || roots.bundle_behavior(asset) != BundleBehavior::None {
        boundaries.insert(r);
      }
    }

    // (Source class, ordered root dependencies) for each asset with boundary edges.
    let mut groups: Vec<(usize, Vec<AvailabilityEdge>)> = Vec::new();

    for (source, asset, _) in asset_graph.dfs() {
      if reachability.reachable_roots(source).is_clear() {
        continue;
      }

      // Retain dependency indices until sorting restores source order across symbol targets.
      let mut edges = Vec::new();

      for (dep_index, target) in asset_graph.resolved_dependencies_with_indices(asset) {
        // Only dependencies targeting explicit roots cross a dataflow boundary.
        let Some(root) = roots.root_index(target) else {
          continue;
        };

        let dep = &asset.dependencies[dep_index];
        let target_asset = asset_graph.asset(target);

        // Cross-environment dependencies start an independent availability scope.
        // Explicit inline/isolated roots were already marked as boundaries above.
        if asset.target.environment != target_asset.target.environment {
          boundaries.insert(root);
        }

        // Choose the transfer rule applied to each incoming occurrence of this root.
        let kind = match dep.priority {
          Priority::Lazy => AvailabilityEdgeKind::Lazy,
          // Non-isolated parallel roots contribute their synchronous classes to
          // subsequent parallel occurrences in this source asset's dependency list.
          Priority::Parallel if roots.bundle_behavior(target) == BundleBehavior::None => {
            AvailabilityEdgeKind::Parallel
          }
          _ => AvailabilityEdgeKind::Sync,
        };

        edges.push((
          dep_index,
          AvailabilityEdge {
            root: root as u32,
            kind,
          },
        ));
      }

      if !edges.is_empty() {
        // Resolved symbol targets can be emitted after a later dependency's
        // side-effect target. Prefixes must follow the original dependency order.
        edges.sort_by_key(|(dep_index, _)| *dep_index);
        groups.push((
          reachability.class(source),
          edges.into_iter().map(|(_, edge)| edge).collect(),
        ));
      }
    }

    Self::new(&reachability.reachable_roots, boundaries, groups)
  }

  fn new(
    class_roots: &[FixedBitSet],
    mut boundaries: FixedBitSet,
    mut groups: Vec<(usize, Vec<AvailabilityEdge>)>,
  ) -> Self {
    // Root-major view of the same relation: each bit is a whole asset class,
    // whose members always enter and leave availability together.
    let mut synchronous = vec![FixedBitSet::with_capacity(class_roots.len()); boundaries.len()];
    for (class, roots) in class_roots.iter().enumerate() {
      for root in roots.ones() {
        synchronous[root].insert(class);
      }
    }

    groups.sort_by_key(|(class, _)| *class);

    // First count groups per source class, then convert the counts to prefix offsets.
    let mut class_group_offsets = vec![0u32; class_roots.len() + 1];
    // Append one end offset after flattening each source asset's occurrence list.
    let mut group_edge_offsets = vec![0u32];
    // Shared backing storage for every group's ordered root dependencies.
    let mut edges = Vec::new();

    for (class, group) in groups {
      class_group_offsets[class + 1] += 1;
      edges.extend(group);
      group_edge_offsets.push(edges.len() as u32);
    }

    for class in 0..class_roots.len() {
      class_group_offsets[class + 1] += class_group_offsets[class];
    }

    // Dead/stale roots can be discovered by BundleRoots without having a live
    // loading path. Never let a disconnected cycle retain TOP and justify an
    // optimization. Reachability here ignores transfer facts and follows only
    // the implicit root graph, without expanding its root/edge cross product.

    // Roots found by a graph walk starting from the known reset boundaries.
    let mut reachable = boundaries.clone();
    // Newly reached roots whose synchronous classes may reveal more root dependencies.
    let mut queue: VecDeque<_> = reachable.ones().collect();
    let mut seen_classes = FixedBitSet::with_capacity(class_roots.len());
    while let Some(root) = queue.pop_front() {
      for class in synchronous[root].ones() {
        if seen_classes.put(class) {
          continue;
        }

        // All groups owned by this class form one contiguous range of edge storage.
        let start = class_group_offsets[class] as usize;
        let end = class_group_offsets[class + 1] as usize;
        for edge in &edges[group_edge_offsets[start] as usize..group_edge_offsets[end] as usize] {
          if !reachable.put(edge.root as usize) {
            queue.push_back(edge.root as usize);
          }
        }
      }
    }

    for root in 0..boundaries.len() {
      if !reachable.contains(root) {
        boundaries.insert(root);
      }
    }

    Self {
      synchronous,
      boundaries,
      class_group_offsets,
      group_edge_offsets,
      edges,
    }
  }

  #[cfg(test)]
  fn solve(&self) -> Vec<FixedBitSet> {
    let mut active_roots = FixedBitSet::with_capacity(self.synchronous.len());
    active_roots.insert_range(..);
    let mut state = AvailabilityState::new(self);
    state.solve(self, &active_roots).to_vec()
  }

  fn needed_roots(
    &self,
    mut reachability: Reachability,
    roots: &BundleRoots,
    available: &[FixedBitSet],
  ) -> Reachability {
    // Root index -> class containing the root asset; retain its explicit bundle identity.
    let root_classes: Vec<_> = roots
      .iter_all()
      .map(|(_, asset)| reachability.class(asset))
      .collect();

    // Project the immutable original classes through the final active-root set.
    // Classes that become equal may stay separate here: BundleKey equality still
    // deduplicates them during placement.
    for class_roots in &mut reachability.reachable_roots {
      class_roots.intersect_with(&roots.active_roots);
    }

    // Reuse reachability's storage for final requirements rather than keeping
    // another class-by-root matrix.
    for root in roots.active_roots.ones() {
      let input = &available[root];
      for class in self.synchronous[root].ones() {
        // Keep explicit bundle roots and their co-generated class. Eliminating
        // a root also requires internalizing its dependency resolutions.
        if class != root_classes[root] && input.contains(class) {
          reachability.reachable_roots[class].set(root, false);
        }
      }
    }

    reachability
  }
}

fn intersect_changed(target: &mut FixedBitSet, source: &FixedBitSet) -> bool {
  debug_assert_eq!(target.len(), source.len());
  // Report whether any facts were removed, without cloning the original target set.
  let mut changed = false;
  for (target, source) in target.as_mut_slice().iter_mut().zip(source.as_slice()) {
    // Intersect one machine word and detect a change during the same scan.
    let next = *target & source;
    changed |= next != *target;
    *target = next;
  }
  changed
}
