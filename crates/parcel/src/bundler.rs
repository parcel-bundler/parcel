use std::{collections::HashMap, hash::Hash};

use fixedbitset::FixedBitSet;
use glob_match::glob_match;
use parcel_core::{
  Asset, AssetGraph, AssetIndex, AssetType, Bundle, BundleBehavior, BundleFlags, BundleGraph,
  BundleGraphDependencyResolution, Bundler, ContentType, DependencyFlags, DependencyId,
  DiagnosticList, Environment, EnvironmentFlags, ParcelOptions, Priority, SpecifierType,
};

use crate::library_bundler::LibraryBundler;
use availability::{AvailabilityGraph, AvailabilityState};
use bit_matrix::{AsBitRow, BitMatrix, BitRow};
use bundle_roots::BundleRoots;
use internalization::Internalization;
use reachability::Reachability;

mod availability;
mod bit_matrix;
mod bundle_roots;
mod internalization;
mod optimizer;
mod reachability;
mod style_order;
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

/// Transfer compression the served bundles are expected to use. Selects the
/// wire-size curve consolidation cost estimates apply to bundle sizes.
#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Compression {
  /// Transfer estimates equal uncompressed sizes, so consolidating disjoint
  /// payloads never reduces cost on its own.
  None,
  Gzip,
  Brotli,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct DefaultBundler {
  /// Manual grouping rules, checked in order so the first matching rule wins.
  #[serde(default)]
  manual_shared_bundles: Vec<ManualSharedBundle>,
  /// Estimated uncompressed bytes. Zero disables size consolidation.
  min_bundle_size: usize,
  /// Requests per loading context. Zero disables request consolidation.
  max_parallel_requests: usize,
  /// Probability of a one-activation session, otherwise two activations.
  first_page_load_priority: f64,
  /// Relative edit frequency of dependencies; source assets have weight one.
  dependency_change_rate: f64,
  /// Expected transfer compression, enabling compression-aware consolidation.
  compression: Compression,
}

impl Default for DefaultBundler {
  fn default() -> Self {
    Self {
      manual_shared_bundles: Vec::new(),
      min_bundle_size: 30_000,
      max_parallel_requests: 25,
      first_page_load_priority: 0.67,
      dependency_change_rate: 0.1,
      compression: Compression::Brotli,
    }
  }
}

impl DefaultBundler {
  fn validate(&self) -> Result<(), DiagnosticList> {
    for (name, value) in [
      ("firstPageLoadPriority", self.first_page_load_priority),
      ("dependencyChangeRate", self.dependency_change_rate),
    ] {
      if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(
          parcel_core::Diagnostic::from_message(format!("{name} must be between 0 and 1")).into(),
        );
      }
    }
    Ok(())
  }

  fn manual_shared_bundle(&self, asset: &Asset, options: &ParcelOptions) -> Option<usize> {
    if self.manual_shared_bundles.is_empty() {
      return None;
    }
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
    reachable_roots: &'a BitRow,
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
    self.validate()?;
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
    for (_, root) in bundle_roots.iter_active() {
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
      let available = availability_state.solve(&availability, &bundle_roots);
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
    let root_ids: Vec<_> = bundle_roots
      .iter_all()
      .map(|(_, root)| asset_graph.asset(root).id_u64(&options.project_root))
      .collect();

    let mut shared_bundles = HashMap::<BundleKey, usize>::new();
    let mut root_bundles = HashMap::<AssetIndex, RootBundle>::new();
    // Dense logical root -> loadable bundle (possibly an entry facade).
    let mut root_to_bundle = vec![0; bundle_roots.len()];
    // Canonical content bundle -> non-JS entry bundles that must package the
    // same assets because their packager cannot use empty execution facades.
    let mut mirrored_bundles = HashMap::<usize, Vec<usize>>::new();

    // Create bundles for each bundle root first.
    for (root_index, bundle_root_asset_index) in bundle_roots.iter_active() {
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
        bundle_behavior: bundle_roots.root_bundle_behavior(root_index),
        flags: if bundle_roots.is_entry_root(root_index) {
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

      let (bundle_index, content_bundle_index) = if let Some(&existing) = shared_bundles.get(&key) {
        // The JS packager supports separating loading from execution. Therefore, if two entries share the
        // same bundle we can convert this into a shared bundle and add an empty entry facade that executes
        // the corresponding main entry module in the shared bundle.
        if asset.ty == AssetType::Js {
          if let Some(previous_root) = bundles[existing].main_entry_asset.take() {
            bundles[existing].entry_assets.clear();
            bundles[existing].id = key.stable_hash(&root_ids);
            let previous_root_index = bundle_roots.root_index(previous_root).unwrap();
            if bundle_roots.is_mandatory(previous_root_index) {
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
              root_to_bundle[previous_root_index] = facade_index;
              root_bundles.get_mut(&previous_root).unwrap().load = facade_index;
            }
            bundles[existing].flags = BundleFlags::empty();
          }

          if bundle_roots.is_mandatory(root_index) {
            let mut facade = bundle;
            facade.id = asset.id_u64(&options.project_root);
            facade.referenced_bundles.push(existing);
            let facade_index = bundles.len();
            bundles.push(facade);
            (facade_index, existing)
          } else {
            (existing, existing)
          }
        } else {
          let mirror = bundles.len();
          bundles.push(bundle);
          mirrored_bundles.entry(existing).or_default().push(mirror);
          (mirror, mirror)
        }
      } else {
        let bundle_index = bundles.len();
        bundles.push(bundle);
        shared_bundles.insert(key, bundle_index);
        (bundle_index, bundle_index)
      };
      root_to_bundle[root_index] = bundle_index;
      root_bundles.insert(
        bundle_root_asset_index,
        RootBundle {
          load: bundle_index,
          content: content_bundle_index,
        },
      );
    }

    // CSS cascade order is semantic: plan stylesheet bundles from each
    // context's application order rather than by class alone.
    let style_plan = style_order::plan(
      &asset_graph,
      &bundle_roots,
      &needed_roots,
      options,
      |asset| asset.ty == AssetType::Css && self.manual_shared_bundle(asset, options).is_none(),
    );
    let mut slot_bundles: Vec<Option<usize>> = vec![None; style_plan.segments.len()];
    // A segment that immediately precedes a stylesheet root in every
    // consumer's sequence joins that root's bundle (the reused-bundle
    // pattern for CSS). The plan only binds the adjacent segment: the root
    // bundle loads at the root's own (last) position, so any earlier segment
    // placed inside it would apply after content it must precede.
    for (slot, segment) in style_plan.segments.iter().enumerate() {
      if let Some(root_asset) = segment.bind_to {
        if let Some(root) = root_bundles.get(&root_asset) {
          slot_bundles[slot] = Some(root.content);
        }
      }
    }

    // Place assets into bundles, following depth-first order.
    for (asset_index, asset, name) in asset_graph.dfs() {
      let is_bundle_root = bundle_roots.is_bundle_root(asset_index);
      let reachable_roots = needed_roots.reachable_roots(asset_index);
      if !is_bundle_root && reachable_roots.is_clear() {
        continue;
      }

      if let Some(slots) = style_plan.slots.get(&asset_index) {
        for &slot in slots {
          let bundle_index = match slot_bundles[slot as usize] {
            Some(bundle_index) => bundle_index,
            None => {
              // Identity mirrors BundleKey::Default's stable hash: derived
              // from the consumer roots and packager (plus the segment
              // ordinal and owning root), never from membership, so bundle
              // names stay stable as stylesheets are added and removed.
              let segment = &style_plan.segments[slot as usize];
              let mut hasher = xxhash_rust::xxh3::Xxh3Default::new();
              2.hash(&mut hasher);
              let mut ids: Vec<u64> = needed_roots
                .reachable_roots(segment.assets[0])
                .ones()
                .map(|root| root_ids[root])
                .collect();
              ids.sort();
              ids.hash(&mut hasher);
              asset.content.ty().hash(&mut hasher);
              segment.ordinal.hash(&mut hasher);
              if let Some(owner) = segment.owner_root {
                root_ids[owner].hash(&mut hasher);
              }
              let bundle_index = bundles.len();
              bundles.push(Bundle {
                id: hasher.digest(),
                ty: asset.ty.clone(),
                target: asset.target.clone(),
                bundle_behavior: BundleBehavior::None,
                flags: BundleFlags::empty(),
                dist_path: None,
                assets: Vec::new(),
                entry_assets: Vec::new(),
                main_entry_asset: None,
                referenced_bundles: Vec::new(),
              });
              slot_bundles[slot as usize] = Some(bundle_index);
              bundle_index
            }
          };
          bundles[bundle_index].assets.push(asset_index);
          if let Some(mirrors) = mirrored_bundles.get(&bundle_index) {
            for &mirror in mirrors {
              bundles[mirror].assets.push(asset_index);
            }
          }
        }
        // References are wired from each root's application order below.
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
          root_bundles.insert(
            asset_index,
            RootBundle {
              load: bundle_index,
              content: bundle_index,
            },
          );
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

    // Planned CSS bundles emit their assets in application order, and each
    // root references its stylesheet bundles in its own order, which the HTML
    // packager and the runtime loader preserve.
    for (slot, bundle_index) in slot_bundles.iter().enumerate() {
      let Some(bundle_index) = *bundle_index else {
        continue;
      };
      let assets = &style_plan.segments[slot].assets;
      // Keep any legacy-placed assets (the root stylesheet itself) after the
      // planned run: an importing root applies after its imports.
      let reorder = |existing: &mut Vec<AssetIndex>| {
        let mut merged = assets.clone();
        merged.extend(existing.iter().copied().filter(|a| !assets.contains(a)));
        *existing = merged;
      };
      let mut merged = std::mem::take(&mut bundles[bundle_index].assets);
      reorder(&mut merged);
      bundles[bundle_index].assets = merged;
      if let Some(mirrors) = mirrored_bundles.get(&bundle_index) {
        for &mirror in mirrors {
          let mut merged = std::mem::take(&mut bundles[mirror].assets);
          reorder(&mut merged);
          bundles[mirror].assets = merged;
        }
      }
    }
    for (root_index, order) in style_plan.root_order.iter().enumerate() {
      if order.is_empty() {
        continue;
      }
      let source = root_to_bundle[root_index];
      for &slot in order {
        let Some(bundle_index) = slot_bundles[slot as usize] else {
          continue;
        };
        if bundle_index != source && !bundles[source].referenced_bundles.contains(&bundle_index) {
          bundles[source].referenced_bundles.push(bundle_index);
        }
      }
    }

    resolve_bundle_dependencies(
      &asset_graph,
      &mut bundles,
      &root_bundles,
      &mut dependency_resolutions,
    );

    optimizer::optimize(
      self,
      &asset_graph,
      &mut bundles,
      &root_bundles,
      &mut dependency_resolutions,
      options,
    )?;

    Ok(BundleGraph::new(
      asset_graph,
      bundles,
      dependency_resolutions,
      options.project_root,
    ))
  }
}

/// A root's loading boundary is independent of where its module is registered.
/// For example, an entry facade executes a module in a shared content bundle,
/// while a mirrored non-JS entry contains its own copy of the content.
struct RootBundle {
  load: usize,
  content: usize,
}

/// All physical placements, including mirrored entries and duplicated assets.
/// Rebuild this snapshot after changing bundle contents, before wiring dependencies.
/// Entry facades are not placements: their entry assets live in another bundle.
struct AssetPlacements {
  bundles: Vec<Vec<usize>>,
}

impl AssetPlacements {
  fn new(asset_count: usize, bundles: &[Bundle]) -> Self {
    let mut placements = Self {
      bundles: vec![Vec::new(); asset_count],
    };
    for (bundle_index, bundle) in bundles.iter().enumerate() {
      for asset in &bundle.assets {
        let indices = &mut placements.bundles[asset.index()];
        // Bundle iteration order makes membership deterministic and lets us
        // avoid duplicate placements even if an asset was inserted twice.
        if indices.last() != Some(&bundle_index) {
          indices.push(bundle_index);
        }
      }
    }
    placements
  }

  fn bundles(&self, asset: AssetIndex) -> &[usize] {
    &self.bundles[asset.index()]
  }

  fn contains(&self, asset: AssetIndex, bundle: usize) -> bool {
    self.bundles(asset).binary_search(&bundle).is_ok()
  }

  /// Test the eager reference closure, rather than selecting an arbitrary copy
  /// of the target (which may belong to an unrelated page or runtime).
  fn is_referenced(&self, asset: AssetIndex, source: usize, bundles: &[Bundle]) -> bool {
    if self.contains(asset, source)
      || bundles[source]
        .referenced_bundles
        .iter()
        .any(|&bundle| self.contains(asset, bundle))
    {
      return true;
    }
    if bundles[source].referenced_bundles.is_empty() {
      return false;
    }
    let mut seen = FixedBitSet::with_capacity(bundles.len());
    let mut stack = vec![source];
    while let Some(bundle) = stack.pop() {
      if seen.contains(bundle) {
        continue;
      }
      if self.contains(asset, bundle) {
        return true;
      }
      seen.insert(bundle);
      stack.extend(bundles[bundle].referenced_bundles.iter().copied());
    }
    false
  }
}

fn resolve_bundle_dependencies(
  asset_graph: &AssetGraph,
  bundles: &mut [Bundle],
  root_bundles: &HashMap<AssetIndex, RootBundle>,
  dependency_resolutions: &mut HashMap<DependencyId, BundleGraphDependencyResolution>,
) {
  let placements = AssetPlacements::new(asset_graph.assets.len(), bundles);
  for (asset_index, asset, _) in asset_graph.dfs() {
    let sources = placements.bundles(asset_index);
    for (dep_index, dep) in asset.dependencies.iter().enumerate() {
      let dependency_id = DependencyId {
        asset: asset_index,
        dependency: dep_index,
      };
      if dependency_resolutions.contains_key(&dependency_id) {
        continue;
      }
      let Some((target, _)) = asset_graph.resolved_asset(dep) else {
        continue;
      };

      // Resolutions are shared by every copy of an asset. Only treat this as
      // intra-bundle when the target is local to ALL copies of the source.
      // In particular, mirrored CSS entries must each inline their own cycle.
      if !sources.is_empty()
        && sources
          .iter()
          .all(|&source| placements.contains(target, source))
      {
        continue;
      }
      let Some(root) = root_bundles.get(&target) else {
        continue;
      };
      let is_sync_module_dep = dep.priority == Priority::Sync
        && dep.bundle_behavior == BundleBehavior::None
        && dep.specifier_type != SpecifierType::Url
        && bundles[root.load].bundle_behavior == BundleBehavior::None;

      if is_sync_module_dep {
        // Keep Asset resolution for the parcelRequire chain. Every source copy
        // needs a provider, but a local or already referenced copy is sufficient.
        // Fall back to the root's explicit content owner, never an entry facade
        // or the first physical placement of the target.
        debug_assert!(placements.contains(target, root.content));
        for &source in sources {
          if !placements.is_referenced(target, source, bundles) {
            bundles[source].referenced_bundles.push(root.content);
          }
        }
      } else {
        // Duplicating an importer does not change its lazy/URL/inline loading
        // boundary. Keep the root's loadable output as the shared resolution.
        dependency_resolutions.insert(
          dependency_id,
          BundleGraphDependencyResolution::Bundle {
            bundle_index: root.load as u32,
            asset_index: target,
          },
        );
        if dep.flags.contains(DependencyFlags::NEEDS_STABLE_NAME) {
          bundles[root.load].flags |= BundleFlags::NEEDS_STABLE_NAME;
        }
      }
    }
  }
}
