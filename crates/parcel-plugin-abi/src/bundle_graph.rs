//! Read-only bundle graph accessors and dependency resolution results.

use parcel_core::{
  Asset as CoreAsset, AssetIndex as CoreAssetIndex,
  BundleGraphDependencyResolution as CoreBundleGraphDependencyResolution, ResolvedDependencies,
};

use crate::{
  AssetIndex, AssetRef, Bundle, BundleGraph, BundleIndex, PARCEL_INVALID_ASSET_INDEX,
  PARCEL_INVALID_BUNDLE_INDEX,
  extensible::{Extensible, write_extensible},
};

#[repr(u8)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq, Default)]
pub enum BundleGraphResolutionType {
  #[default]
  PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID = 0,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE = 1,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED = 2,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL = 3,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED = 4,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET = 5,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE = 6,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_INTERNALIZED = 7,
}

/// The resolution of a dependency in the bundle graph, written by
/// `parcel_bundle_graph_get_dependency_resolution()`.
///
/// Initialize it as `BundleGraphDependencyResolution resolution = {.size = sizeof(resolution)};`.
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct BundleGraphDependencyResolution {
  /// `sizeof(BundleGraphDependencyResolution)`, set by the caller. Always the first member.
  pub size: usize,
  /// `PARCEL_BUNDLE_GRAPH_RESOLUTION_*`
  pub resolution_type: BundleGraphResolutionType,
  /// The asset the dependency resolved to, when `resolution_type` is
  /// `PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET` (an asset in the same bundle),
  /// `PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE` (an asset in another bundle) or
  /// `PARCEL_BUNDLE_GRAPH_RESOLUTION_INTERNALIZED` (an asset in a bundle inlined
  /// into this one). `PARCEL_INVALID_ASSET_INDEX` otherwise.
  pub asset: AssetIndex,
  /// The bundle the dependency resolved to, only when `resolution_type` is
  /// `PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE`. `PARCEL_INVALID_BUNDLE_INDEX`
  /// otherwise.
  pub bundle: BundleIndex,
}

impl Default for BundleGraphDependencyResolution {
  fn default() -> Self {
    Self {
      size: size_of::<Self>(),
      resolution_type: BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID,
      asset: PARCEL_INVALID_ASSET_INDEX,
      bundle: PARCEL_INVALID_BUNDLE_INDEX,
    }
  }
}

// Only Parcel writes this struct, so its enum field can stay typed.
unsafe impl Extensible for BundleGraphDependencyResolution {
  const MIN_SIZE: usize =
    std::mem::offset_of!(BundleGraphDependencyResolution, bundle) + size_of::<BundleIndex>();
}

/// One of the assets an asset depends on, written by
/// `parcel_bundle_graph_get_next_resolved_dependency()`.
///
/// Initialize it as `ResolvedDependency dependency = {.size = sizeof(dependency)};`.
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct ResolvedDependency {
  /// `sizeof(ResolvedDependency)`, set by the caller. Always the first member.
  pub size: usize,
  /// The index of the dependency, among the asset's, that the asset was reached
  /// through. Pass it to `parcel_bundle_graph_get_dependency_resolution()` to find
  /// out which bundle `asset` is in.
  pub dependency_index: usize,
  /// The asset depended on. Not necessarily the one the dependency itself resolved
  /// to: a symbol imported through it may resolve past a side-effect free re-export.
  pub asset: AssetIndex,
}

impl_extensible!(
  ResolvedDependency,
  min_size = std::mem::offset_of!(ResolvedDependency, asset) + size_of::<AssetIndex>()
);

// ── Bundle graph (read-only) ─────────────────────────────────────────────────

/// Returns the number of assets in the graph.
pub extern "C" fn parcel_bundle_graph_get_asset_count(bundle_graph: BundleGraph) -> usize {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph.asset_graph.assets.len()
}

/// Returns a borrowed, read-only asset handle, or zero when `index` is out of bounds.
/// The handle is valid only for the lifetime of the bundle graph and must only be
/// passed to `parcel_asset_get_*` functions.
pub extern "C" fn parcel_bundle_graph_get_asset(
  bundle_graph: BundleGraph,
  index: AssetIndex,
) -> AssetRef {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph
    .asset_graph
    .assets
    .get(index as usize)
    .map_or(0, |asset| asset as *const CoreAsset as AssetRef)
}

/// Returns the number of bundles in the graph.
pub extern "C" fn parcel_bundle_graph_get_bundle_count(bundle_graph: BundleGraph) -> usize {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph.bundles.len()
}

/// Returns a borrowed bundle handle, or zero when `index` is out of bounds.
pub extern "C" fn parcel_bundle_graph_get_bundle(
  bundle_graph: BundleGraph,
  index: BundleIndex,
) -> Bundle {
  if bundle_graph == 0 {
    return 0;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  bundle_graph
    .bundles
    .get(index)
    .map_or(0, |bundle| bundle as *const parcel_core::Bundle as Bundle)
}

/// Writes the resolution of one dependency belonging to an asset into `*resolution`, whose `size`
/// the caller sets. Writes `PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID` for invalid indices, and
/// nothing at all when `size` is unset.
pub extern "C" fn parcel_bundle_graph_get_dependency_resolution(
  resolution: *mut BundleGraphDependencyResolution,
  bundle_graph: BundleGraph,
  asset: AssetIndex,
  dependency_index: usize,
) {
  if resolution.is_null() {
    return;
  }
  let value = dependency_resolution(bundle_graph, asset, dependency_index);
  unsafe { write_extensible(resolution, value) };
}

fn dependency_resolution(
  bundle_graph: BundleGraph,
  asset: AssetIndex,
  dependency_index: usize,
) -> BundleGraphDependencyResolution {
  if bundle_graph == 0 {
    return BundleGraphDependencyResolution::default();
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  let Some(asset_value) = bundle_graph.asset_graph.assets.get(asset as usize) else {
    return BundleGraphDependencyResolution::default();
  };
  if dependency_index >= asset_value.dependencies.len() {
    return BundleGraphDependencyResolution::default();
  }

  let mut result = BundleGraphDependencyResolution::default();
  match bundle_graph.dependency_resolution(CoreAssetIndex(asset), dependency_index) {
    CoreBundleGraphDependencyResolution::None => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE;
    }
    CoreBundleGraphDependencyResolution::Deferred => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED;
    }
    CoreBundleGraphDependencyResolution::External => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL;
    }
    CoreBundleGraphDependencyResolution::Excluded => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED;
    }
    CoreBundleGraphDependencyResolution::Asset(asset) => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET;
      result.asset = asset.0;
    }
    CoreBundleGraphDependencyResolution::Bundle {
      bundle_index,
      asset_index,
    } => {
      result.resolution_type = BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE;
      result.bundle = bundle_index as usize;
      result.asset = asset_index.0;
    }
    CoreBundleGraphDependencyResolution::Internalized(asset) => {
      result.resolution_type =
        BundleGraphResolutionType::PARCEL_BUNDLE_GRAPH_RESOLUTION_INTERNALIZED;
      result.asset = asset.0;
    }
  }
  result
}

/// Writes the next asset that `asset` depends on into `*dependency`, whose `size` the caller
/// sets, and advances `*cursor`. Start with `*cursor` set to zero and call it until it returns
/// false; the value is otherwise opaque.
///
/// Assets come in the order the asset depends on them: each dependency's own resolution, when
/// the asset needs it (it has side effects, or the asset re-exports through it), followed by the
/// assets the symbols imported through it resolved to. The same asset may appear more than
/// once. Dependencies the asset doesn't need, and side-effect free re-exports, are skipped.
///
/// Returns false, writing nothing, at the end, for invalid handles or indices, or when `size` is
/// unset.
pub extern "C" fn parcel_bundle_graph_get_next_resolved_dependency(
  dependency: *mut ResolvedDependency,
  bundle_graph: BundleGraph,
  asset: AssetIndex,
  cursor: *mut u64,
) -> bool {
  if dependency.is_null() || cursor.is_null() || bundle_graph == 0 {
    return false;
  }
  let bundle_graph: &parcel_core::BundleGraph =
    unsafe { &*(bundle_graph as *const parcel_core::BundleGraph) };
  let asset_graph = &bundle_graph.asset_graph;
  let Some(asset) = asset_graph.assets.get(asset as usize) else {
    return false;
  };

  let mut iter = ResolvedDependencies::resume(asset_graph, asset, unsafe { cursor.read() });
  let Some((dependency_index, resolved)) = iter.next() else {
    return false;
  };
  let value = ResolvedDependency {
    dependency_index,
    asset: resolved.0,
    ..Default::default()
  };
  if !unsafe { write_extensible(dependency, value) } {
    return false;
  }
  unsafe { cursor.write(iter.cursor()) };
  true
}
