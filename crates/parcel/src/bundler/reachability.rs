use std::collections::HashMap;

use parcel_core::{Asset, AssetGraph, AssetIndex, BundleBehavior, Dependency, Priority};

use super::bit_matrix::{BitMatrix, BitRow};
use super::bundle_roots::BundleRoots;

pub struct Reachability {
  // Asset index -> class ID.
  // SCCs with identical reachable-root sets form a "class". Every asset in
  // a class is generated together by availability's synchronous root closures.
  // Unreachable assets map to the shared empty class.
  asset_classes: Vec<u32>,
  // Class ID -> row of dense root indices. Initially these are synchronous
  // reaching roots. Availability later removes roots with guaranteed availability.
  // Classes remain based on the original sets, so filtered sets can be equal.
  reachable_roots: BitMatrix,
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

    // One row per component, plus a trailing empty component shared by all
    // unreachable assets.
    let component_count = offsets.len() - 1;
    let mut reachable_roots = BitMatrix::new(component_count + 1, bundle_roots.len());
    for (root_index, root) in bundle_roots.iter_all() {
      reachable_roots.insert(asset_components[root.index()] as usize, root_index);
    }

    // Tarjan emits components in reverse topological order. Replay the recorded
    // edges to propagate through the implicit condensation DAG.
    let mut seen = vec![u32::MAX; component_count];
    for component in (0..component_count).rev() {
      for &member in &members[offsets[component] as usize..offsets[component + 1] as usize] {
        let d = discovery[member as usize] as usize;
        for &target in &edge_targets[edge_offsets[d] as usize..edge_offsets[d + 1] as usize] {
          let target_component = asset_components[target as usize] as usize;
          if target_component != component && seen[target_component] != component as u32 {
            debug_assert!(target_component < component);
            seen[target_component] = component as u32;
            reachable_roots.union_rows(target_component, component);
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

  pub fn from_components(mut asset_classes: Vec<u32>, mut reachable_roots: BitMatrix) -> Self {
    let component_count = reachable_roots.rows() - 1;
    // Intern equal sets, including equal sets from distinct SCCs, by borrowing
    // rows so this does not copy the reachability matrix.
    let mut classes = HashMap::new();
    // Temporary SCC ID -> canonical class ID, including the trailing empty SCC.
    let component_classes: Vec<u32> = reachable_roots
      .iter()
      .map(|roots| {
        let next = classes.len() as u32;
        *classes.entry(roots).or_insert(next)
      })
      .collect();
    let class_count = classes.len();
    drop(classes);
    for component in &mut asset_classes {
      *component = component_classes[(*component as usize).min(component_count)];
    }
    // Class IDs follow first appearance, so a component introduces a new class
    // exactly when its class ID equals the number of classes seen so far, and
    // that class's row sits at or before it: compact in place, then drop the rest.
    let mut next = 0;
    for (component, &class) in component_classes.iter().enumerate() {
      let class = class as usize;
      if class == next {
        reachable_roots.copy_row(class, component);
        next += 1;
      }
    }
    // Interning typically collapses most components: a deep synchronous chain
    // has one class per root but one component per asset. Release the
    // component-sized buffer rather than carrying it for the whole build.
    reachable_roots.truncate(class_count);
    reachable_roots.shrink_to_fit();

    Reachability {
      asset_classes,
      reachable_roots,
    }
  }

  pub fn reachable_roots(&self, index: AssetIndex) -> &BitRow {
    self.roots_for_class(self.class(index))
  }

  pub fn roots_for_class(&self, class: usize) -> &BitRow {
    &self.reachable_roots[class]
  }

  pub fn class(&self, index: AssetIndex) -> usize {
    self.asset_classes[index.index()] as usize
  }

  pub fn class_count(&self) -> usize {
    self.reachable_roots.rows()
  }

  pub fn classes(&self) -> impl Iterator<Item = (usize, &BitRow)> {
    self.reachable_roots.iter().enumerate()
  }

  pub fn retain_active_roots(&mut self, roots: &BundleRoots) {
    for class in 0..self.reachable_roots.rows() {
      roots.retain_active(&mut self.reachable_roots[class]);
    }
  }

  pub fn remove_root_from_class(&mut self, class: usize, root: usize) {
    self.reachable_roots.set(class, root, false);
  }
}

// Use dependency metadata rather than root membership: a demoted async target
// is placed with its synchronous providers, never pulled into its async importer.
pub(super) fn synchronous_dependencies<'a>(
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

pub(super) fn is_sync_dep(
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
