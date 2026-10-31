//! Opaque handles shared across ABI domains.

// ── Opaque handle type aliases ────────────────────────────────────────────────
// cbindgen emits these as: typedef uint64_t Asset; etc.

/// Opaque handle to the asset a transformer is transforming, which it may change.
/// Only `parcel_plugin_transform()` hands one out, and it is valid until that call
/// returns. It can be passed anywhere an `AssetRef` is expected.
pub type Asset = u64;
/// Opaque handle to an asset that may only be read, such as one from
/// `parcel_bundle_graph_get_asset()`. Pass to the `parcel_asset_get_*` functions.
/// Passing one where an `Asset` is expected, to a function that changes the
/// asset, is undefined behavior: other threads may be reading it.
pub type AssetRef = u64;
/// Opaque handle to a Parcel target. Obtained via `parcel_asset_get_target()`.
pub type Target = u64;
/// Opaque, read-only handle to a Parcel dependency. Passed to
/// `parcel_plugin_resolve()`, and returned by `parcel_asset_get_dependency()`,
/// in which case it is valid until the next `parcel_asset_add_dependency()` on
/// the same asset, or until the call that obtained it returns.
pub type Dependency = u64;
/// Opaque handle to the context of the current call into the plugin: the build's
/// options, and whatever the call may do, such as reading files. Every entry
/// point receives one. It is valid only until that call returns, so never store
/// it, in plugin state or custom content.
pub type Options = u64;
/// Opaque handle to Parcel bundle graph.
pub type BundleGraph = u64;
/// Opaque handle to Parcel bundle.
pub type Bundle = u64;
/// Opaque, read-only handle to a list of diagnostics: those a reporter event
/// carries, or a `Diagnostics` list. Pass to the `parcel_diagnostics_*` and
/// `parcel_diagnostic_*` getters. Valid until the call that received it returns.
pub type DiagnosticsRef = u64;
/// Opaque handle to a list of diagnostics Parcel handed the plugin during the
/// current call, such as those a failed read reports. Readable anywhere a
/// `DiagnosticsRef` is expected, and reported as they were by setting
/// `DiagnosticOptions.diagnostics` to it. Parcel frees it when the call returns.
pub type Diagnostics = u64;
/// Index of an asset within the bundle graph.
pub type AssetIndex = u32;
/// Index of a bundle within the bundle graph.
pub type BundleIndex = usize;

/// An asset index no asset has, returned by getters for a missing asset.
pub const PARCEL_INVALID_ASSET_INDEX: AssetIndex = 0xffff_ffff;
/// A bundle index no bundle has (`SIZE_MAX`), where there is no bundle to
/// point at. Index 0 is a valid bundle, so it can't serve.
pub const PARCEL_INVALID_BUNDLE_INDEX: BundleIndex = usize::MAX;
