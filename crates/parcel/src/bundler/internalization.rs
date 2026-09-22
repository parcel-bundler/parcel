use std::collections::HashMap;

use fixedbitset::FixedBitSet;
use parcel_core::{
  AssetGraph, AssetIndex, AssetType, BundleBehavior, BundleGraphDependencyResolution, DependencyId,
  Environment, ImportType, Priority, SourceType, SpecifierType,
};

use super::{
  availability::AvailabilityGraph,
  bit_matrix::{AsBitRow, BitMatrix},
  bundle_roots::BundleRoots,
  reachability::Reachability,
};

pub struct Internalization {
  // Ordinary lazy JavaScript dependencies that may become internalized.
  candidates: Vec<InternalizationCandidate>,
  // Dense root -> lazy loading causes not yet internalized. Ineligible causes
  // remain counted and therefore keep their target roots active.
  remaining_causes: Vec<u32>,
  // Dense root -> environment of its synchronously loaded module registry.
  root_environments: Vec<Environment>,
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

impl Internalization {
  pub fn new(
    graph: &AssetGraph,
    roots: &BundleRoots,
    reachability: &Reachability,
    availability: &AvailabilityGraph,
    manual_roots: &FixedBitSet,
  ) -> Self {
    // A JS module's presence alone does not prove its CSS/parallel resources
    // loaded. Compute this once because the synchronous topology is immutable.
    let mut resource_classes = FixedBitSet::with_capacity(reachability.class_count());
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
      if roots.root_bundle_behavior(root) == BundleBehavior::None
        && !manual_roots.contains(asset.index())
        && availability
          .synchronous_classes(root)
          .is_disjoint(resource_classes.bits())
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
        // A grouped member loads as its canonical root, which must stay
        // active until every member's causes are gone.
        let Some(target_root) = roots.root_index(target).map(|root| roots.canonical(root)) else {
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

  pub fn run(
    &mut self,
    roots: &mut BundleRoots,
    reachability: &Reachability,
    availability: &AvailabilityGraph,
    available: &BitMatrix,
    resolutions: &mut HashMap<DependencyId, BundleGraphDependencyResolution>,
  ) -> bool {
    for candidate in &mut self.candidates {
      if candidate.internalized {
        continue;
      }

      let contexts = reachability.roots_for_class(candidate.source_class as usize);
      let target_class = candidate.target_class as usize;
      let fails = |root: usize| {
        self.root_environments[root] != candidate.environment
          || (!available[root].contains(target_class)
            && !availability
              .synchronous_classes(root)
              .contains(target_class))
      };

      // Most rejected candidates fail for the same context on every round.
      let previous = candidate.failed_context as usize;
      if candidate.failed_context != u32::MAX
        && roots.is_active(previous)
        && contexts.contains(previous)
        && fails(previous)
      {
        continue;
      }

      let mut has_context = false;
      let mut failure = None;
      for root in contexts.ones() {
        if !roots.is_active(root) {
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
      if !roots.is_active(root) || !roots.is_canonical(root) {
        continue;
      }
      if self.remaining_causes[root] == 0 && !roots.is_mandatory(root) {
        roots.deactivate(root);
        removed = true;
      }
    }
    removed
  }
}
