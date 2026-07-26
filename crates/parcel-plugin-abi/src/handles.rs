//! Opaque handles shared across ABI domains.

// ── Opaque handle type aliases ────────────────────────────────────────────────
// cbindgen emits these as: typedef uint64_t Asset; etc.

/// Opaque handle to a Parcel asset. Pass to `parcel_asset_*` functions.
pub type Asset = u64;
/// Opaque handle to a Parcel target. Obtained via `parcel_asset_get_target()`.
pub type Target = u64;
/// Opaque handle to a Parcel dependency. Passed to `parcel_plugin_resolve()`.
pub type Dependency = u64;
/// Opaque handle to Parcel build options. Passed to all plugin entry points.
pub type Options = u64;
/// Opaque handle to Parcel bundle graph.
pub type BundleGraph = u64;
/// Opaque handle to Parcel bundle.
pub type Bundle = u64;
/// Index of an asset within the bundle graph.
pub type AssetIndex = u32;
/// Index of a bundle within the bundle graph.
pub type BundleIndex = usize;

pub const PARCEL_INVALID_ASSET_INDEX: AssetIndex = 0xffff_ffff;
