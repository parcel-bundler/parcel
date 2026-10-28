internal import CParcelABI

/// Read-only access to the bundle graph while naming, optimizing, packaging, or
/// reporting.
///
/// It and everything obtained from it are valid only for the duration of the
/// plugin call it was passed to. Reads are safe from several tasks at once, so a
/// plugin may fan work out over the graph with a task group.
public struct BundleGraph: Sendable {
  let raw: UInt64
  let options: Options

  init(raw: UInt64, options: Options) {
    self.raw = raw
    self.options = options
  }

  @inline(__always)
  private func host<R>(_ body: () -> R) -> R {
    options.scope.shared("BundleGraph", body)
  }

  public var assetCount: Int {
    host { Int(parcel_bundle_graph_get_asset_count(raw)) }
  }

  /// The asset at `index`, or `nil` when it is out of range.
  public func asset(at index: AssetIndex) -> AssetView? {
    let asset = host { parcel_bundle_graph_get_asset(raw, index) }
    guard asset != 0 else { return nil }
    return AssetView(raw: asset, index: index, options: options)
  }

  /// Every asset in the graph, in index order.
  public var assets: [AssetView] {
    (0..<assetCount).compactMap { asset(at: AssetIndex($0)) }
  }

  public var bundleCount: Int {
    host { Int(parcel_bundle_graph_get_bundle_count(raw)) }
  }

  /// The bundle at `index`, or `nil` when it is out of range.
  public func bundle(at index: BundleIndex) -> OutputBundle? {
    let bundle = host { parcel_bundle_graph_get_bundle(raw, UInt(index)) }
    guard bundle != 0 else { return nil }
    return OutputBundle(raw: bundle, options: options)
  }

  /// Every bundle in the graph.
  public var bundles: [OutputBundle] {
    (0..<bundleCount).compactMap { bundle(at: $0) }
  }

  /// What the dependency at `dependencyIndex` of the asset at `asset` resolved to.
  /// ``DependencyResolution/invalid`` for an index out of range, and for a kind
  /// of resolution this SDK predates.
  public func resolution(ofDependency dependencyIndex: Int, of asset: AssetIndex)
    -> DependencyResolution
  {
    guard dependencyIndex >= 0 else { return .invalid }
    let resolution = host {
      withSized(CParcelABI.BundleGraphDependencyResolution.self) { resolution in
        parcel_bundle_graph_get_dependency_resolution(
          resolution, raw, asset, UInt(dependencyIndex))
        return resolution.pointee
      }
    }
    switch resolution.resolution_type {
    case 1: return .none
    case 2: return .deferred
    case 3: return .external
    case 4: return .excluded
    case 5: return .asset(resolution.asset)
    case 6: return BundleIndex(exactly: resolution.bundle).map { .bundle($0) } ?? .invalid
    case 7: return .internalized
    default: return .invalid
    }
  }
}

/// What a dependency in a ``BundleGraph`` resolved to.
public enum DependencyResolution: Hashable, Sendable {
  /// The asset or dependency index was out of range, or the dependency resolved
  /// to something this SDK predates.
  case invalid
  /// Not resolved to anything.
  case none
  /// Resolved lazily, and not yet built.
  case deferred
  case external
  case excluded
  /// An asset in the same bundle.
  case asset(AssetIndex)
  /// Another bundle.
  case bundle(BundleIndex)
  /// A bundle that was inlined into this one.
  case internalized
}

/// Read-only access to an asset in a ``BundleGraph``.
public struct AssetView: Sendable {
  let raw: UInt64
  let options: Options
  /// The asset's index in the graph.
  public let index: AssetIndex

  init(raw: UInt64, index: AssetIndex, options: Options) {
    self.raw = raw
    self.index = index
    self.options = options
  }

  @inline(__always)
  private func host<R>(_ body: () -> R) -> R {
    options.scope.shared("AssetView", body)
  }

  public var content: String {
    host { hostString { parcel_asset_get_content_utf8($0, raw) } ?? "" }
  }

  public var contentBytes: [UInt8] {
    host { hostBytes { parcel_asset_get_content($0, raw) } ?? [] }
  }

  /// The asset's custom content, when this plugin set it.
  public var customContent: (any AssetContent)? {
    host { CustomContentBox.content(of: raw) }
  }

  /// The asset's custom content, when this plugin set it as a `T`.
  public func customContent<T: AssetContent>(as type: T.Type) -> T? {
    customContent as? T
  }

  public var type: String {
    host { hostString { parcel_asset_get_type($0, raw) } ?? "" }
  }

  public var filePath: String {
    host { hostString { parcel_asset_get_file_path($0, raw, options.raw) } ?? "" }
  }

  public var query: String {
    host { hostString { parcel_asset_get_query($0, raw) } ?? "" }
  }

  public var pipeline: String? {
    host { hostString { parcel_asset_get_pipeline($0, raw) } }
  }

  public var bundleBehavior: BundleBehavior {
    host { BundleBehavior(rawValue: parcel_asset_get_bundle_behavior(raw)) }
  }

  public var flags: AssetFlags {
    host { AssetFlags(rawValue: parcel_asset_get_flags(raw)) }
  }

  public var uniqueKey: String? {
    host { hostString { parcel_asset_get_unique_key($0, raw) } }
  }

  public var target: Target {
    host { Target(raw: parcel_asset_get_target(raw), options: options) }
  }

  public var dependencyCount: Int {
    host { Int(parcel_asset_get_dependency_count(raw)) }
  }

  /// The dependency at `index`, or `nil` when it is out of range.
  public func dependency(at index: Int) -> Dependency? {
    let dependency = host { parcel_asset_get_dependency(raw, UInt(index)) }
    guard dependency != 0 else { return nil }
    return Dependency(raw: dependency, options: options)
  }

  public var dependencies: [Dependency] {
    (0..<dependencyCount).compactMap { dependency(at: $0) }
  }
}

/// Read-only access to a bundle in a ``BundleGraph``.
///
/// (Named to avoid clashing with Foundation's `Bundle`.)
public struct OutputBundle: Sendable {
  let raw: UInt64
  let options: Options

  init(raw: UInt64, options: Options) {
    self.raw = raw
    self.options = options
  }

  @inline(__always)
  private func host<R>(_ body: () -> R) -> R {
    options.scope.shared("OutputBundle", body)
  }

  /// The bundle's type, as a file extension such as `"js"`.
  public var type: String {
    host { hostString { parcel_bundle_get_type($0, raw) } ?? "" }
  }

  public var target: Target {
    host { Target(raw: parcel_bundle_get_target(raw), options: options) }
  }

  public var bundleBehavior: BundleBehavior {
    host { BundleBehavior(rawValue: parcel_bundle_get_bundle_behavior(raw)) }
  }

  public var flags: BundleFlags {
    host { BundleFlags(rawValue: parcel_bundle_get_flags(raw)) }
  }

  /// The absolute output path, once the bundle has been named.
  public var distPath: String? {
    host { hostString { parcel_bundle_get_dist_path($0, raw) } }
  }

  /// The indices of the bundle's assets.
  public var assets: [AssetIndex] {
    host {
      (0..<parcel_bundle_get_asset_count(raw)).map { parcel_bundle_get_asset(raw, $0) }
    }
  }

  /// The indices of the bundle's entry assets.
  public var entryAssets: [AssetIndex] {
    host {
      (0..<parcel_bundle_get_entry_asset_count(raw)).map { parcel_bundle_get_entry_asset(raw, $0) }
    }
  }

  /// The index of the bundle's main entry asset, when it has one.
  public var mainEntryAsset: AssetIndex? {
    let index = host { parcel_bundle_get_main_entry_asset(raw) }
    return index == AssetIndex(PARCEL_INVALID_ASSET_INDEX) ? nil : index
  }

  /// The bundle's file name, once the bundle has been named.
  public var name: String? {
    host { hostString { parcel_bundle_get_name($0, raw) } }
  }

  public var absoluteURL: String? {
    host { hostString { parcel_bundle_get_absolute_url($0, raw) } }
  }

  /// The URL of this bundle relative to `bundle`.
  public func relativeURL(from bundle: OutputBundle) -> String? {
    host { hostString { parcel_bundle_get_relative_url($0, raw, bundle.raw) } }
  }

  /// The import specifier that loads this bundle from `bundle`.
  public func relativeSpecifier(from bundle: OutputBundle) -> String? {
    host { hostString { parcel_bundle_get_relative_specifier($0, raw, bundle.raw) } }
  }

  /// A key that identifies the bundle across builds.
  public var stableKey: String? {
    host { hostString { parcel_bundle_get_stable_key($0, raw) } }
  }

  /// The placeholder Parcel replaces with the bundle's content hash.
  public var hashReference: String {
    host { hostString { parcel_bundle_get_hash_reference($0, raw) } ?? "" }
  }
}
