internal import CParcelABI

#if canImport(FoundationEssentials)
  import FoundationEssentials
#else
  import Foundation
#endif

/// The asset being transformed.
///
/// Valid only for the duration of the ``Transformer/transform(_:options:)`` call
/// it was passed to. It is deliberately not `Sendable`: Parcel holds the asset
/// exclusively for the call, so it may only be used from that call's own task —
/// not from an actor, a detached task, or a task-group child.
///
/// Its properties are `nonmutating`, so they can be set on the parameter itself:
///
/// ```swift
/// asset.content = "export default 42;"
/// asset.type = "js"
/// ```
public struct Asset {
  let raw: UInt64
  let options: Options

  init(raw: UInt64, options: Options) {
    self.raw = raw
    self.options = options
  }

  @inline(__always)
  private func host<R>(_ body: () -> R) -> R {
    options.scope.exclusive("Asset", body)
  }

  // ── Content ──────────────────────────────────────────────────────────────

  /// The asset's source as UTF-8 text.
  public var content: String {
    get { host { hostString { parcel_asset_get_content_utf8($0, raw) } ?? "" } }
    nonmutating set {
      host { withBytes(newValue) { parcel_asset_set_content_utf8(raw, $0, UInt32($1)) } }
    }
  }

  /// The asset's source as raw bytes. To set it from `Data` or other bytes, use
  /// ``setContent(_:sourceMap:)-(DataProtocol,_)``.
  public var contentBytes: [UInt8] {
    get { host { hostBytes { parcel_asset_get_content($0, raw) } ?? [] } }
    nonmutating set {
      host { withBytes(newValue) { parcel_asset_set_content(raw, $0, UInt32($1)) } }
    }
  }

  /// Replaces the content with text, optionally along with a JSON (v3) source
  /// map describing it.
  ///
  /// The map's sources may be absolute paths, `file://` URLs, or paths relative
  /// to the asset's directory. Parcel composes it with the maps of later
  /// transformers, so the final bundle maps back to the files this one read.
  public func setContent(_ content: String, sourceMap: String? = nil) {
    guard let sourceMap else {
      self.content = content
      return
    }
    host {
      withBytes(content) { data, count in
        withBytes(sourceMap) { map, mapCount in
          parcel_asset_set_content_utf8_with_map(raw, data, count, map, mapCount)
        }
      }
    }
  }

  /// Replaces the content with bytes — `[UInt8]`, `Data`, or any other
  /// `DataProtocol` — optionally along with a JSON (v3) source map describing
  /// them. See ``setContent(_:sourceMap:)-(String,_)``.
  public func setContent(_ bytes: some DataProtocol, sourceMap: String? = nil) {
    host {
      withBytes(bytes) { data, count in
        if let sourceMap {
          withBytes(sourceMap) { map, mapCount in
            parcel_asset_set_content_with_map(raw, data, count, map, mapCount)
          }
        } else {
          parcel_asset_set_content(raw, data, UInt32(count))
        }
      }
    }
  }

  /// The JSON (v3) source map describing the current content, or `nil` if it
  /// has none.
  ///
  /// This is the map an earlier transformer attached (with
  /// ``setContent(_:sourceMap:)-(String,_)`` in a native plugin, or
  /// `setCode(code, map)` in a JS one), exactly as it was set: its sources may
  /// be absolute paths, `file://` URLs, or paths relative to the asset's
  /// directory. Replacing the content without a map drops it, so a transformer
  /// that edits the content should update this map and pass it back with
  /// ``setContent(_:sourceMap:)-(String,_)`` to keep the bundle mapping to the
  /// original files.
  public var sourceMap: String? {
    host { hostString { parcel_asset_get_map($0, raw) } }
  }

  // ── Metadata ─────────────────────────────────────────────────────────────

  /// The asset's type, as a file extension such as `"js"` or `"css"`.
  public var type: String {
    get { host { hostString { parcel_asset_get_type($0, raw) } ?? "" } }
    nonmutating set {
      guard !newValue.isEmpty else { return }
      host { withBytes(newValue) { parcel_asset_set_type(raw, $0, $1) } }
    }
  }

  /// The absolute path of the source file.
  public var filePath: String {
    host { hostString { parcel_asset_get_file_path($0, raw, options.raw) } ?? "" }
  }

  /// The query string of the asset's source URL.
  public var query: String {
    host { hostString { parcel_asset_get_query($0, raw) } ?? "" }
  }

  /// The named pipeline, e.g. `url` in `url:./image.png`.
  public var pipeline: String? {
    get { host { hostString { parcel_asset_get_pipeline($0, raw) } } }
    nonmutating set {
      host { withOptionalBytes(newValue) { parcel_asset_set_pipeline(raw, $0, $1) } }
    }
  }

  public var bundleBehavior: BundleBehavior {
    get { host { BundleBehavior(rawValue: parcel_asset_get_bundle_behavior(raw)) } }
    nonmutating set { host { parcel_asset_set_bundle_behavior(raw, newValue.rawValue) } }
  }

  public var flags: AssetFlags {
    get { host { AssetFlags(rawValue: parcel_asset_get_flags(raw)) } }
    nonmutating set { host { parcel_asset_set_flags(raw, newValue.rawValue) } }
  }

  public var uniqueKey: String? {
    get { host { hostString { parcel_asset_get_unique_key($0, raw) } } }
    nonmutating set {
      host { withOptionalBytes(newValue) { parcel_asset_set_unique_key(raw, $0, $1) } }
    }
  }

  /// The target the asset is being built for.
  public var target: Target {
    host { Target(raw: parcel_asset_get_target(raw), options: options) }
  }

  // ── Dependencies and symbols ─────────────────────────────────────────────

  /// Adds a dependency to the asset. It inherits the asset's target.
  public func addDependency(_ dependency: DependencyOptions) {
    host { dependency.withRaw { parcel_asset_add_dependency(raw, $0) } }
  }

  /// Adds a dependency on `specifier` to the asset.
  public func addDependency(
    _ specifier: String,
    specifierType: SpecifierType = .esm,
    priority: Priority = .sync,
    bundleBehavior: BundleBehavior = .none,
    flags: DependencyFlags = [],
    conditions: ExportsConditions = []
  ) {
    addDependency(
      DependencyOptions(
        specifier, specifierType: specifierType, priority: priority,
        bundleBehavior: bundleBehavior, flags: flags, conditions: conditions))
  }

  /// Resolves `dependency` with the configured resolvers, exactly as if it had
  /// been added with ``addDependency(_:)``, without adding it.
  ///
  /// `from` is the absolute path of the file containing the import, when that is
  /// not the asset itself, e.g. a Sass partial the asset pulled in. Every file
  /// the resolvers read or probe invalidates the asset, so the transform re-runs
  /// when the result would change.
  ///
  /// Returns `nil` when the dependency could not be resolved to anything.
  public func resolve(_ dependency: DependencyOptions, from: String? = nil) -> ResolveResult? {
    host {
      var result = CParcelABI.ResolveResult()
      let resolved = dependency.withRaw { dep in
        withBytes(from ?? "") { parcel_asset_resolve(raw, options.raw, dep, $0, $1, &result) }
      }
      let filePath = takeString(&result.file_path)
      let pipeline = takeString(&result.pipeline)
      guard resolved else { return nil }
      switch result.resolution_type {
      case 1: return filePath.map { .resolved(filePath: $0, pipeline: pipeline) }
      case 2: return .external
      case 3: return .excluded
      default: return nil
      }
    }
  }

  /// Resolves `specifier` as an ES module import. See ``resolve(_:from:)-(DependencyOptions,_)``.
  public func resolve(_ specifier: String, from: String? = nil) -> ResolveResult? {
    resolve(DependencyOptions(specifier), from: from)
  }

  /// Registers an exported symbol name, e.g. `"default"`, `"foo"`, or `"*"`.
  public func addExportSymbol(_ name: String) {
    guard !name.isEmpty else { return }
    host { withBytes(name) { parcel_asset_add_export_symbol(raw, $0, $1) } }
  }

  // ── Custom content ───────────────────────────────────────────────────────

  /// Replaces the asset's content with plugin-owned data, which Parcel keeps until
  /// it packages the asset. See ``AssetContent``.
  public func setCustomContent(_ content: some AssetContent) {
    host { CustomContentBox.attach(content, to: raw) }
  }

  /// The asset's custom content, when this plugin set it.
  public var customContent: (any AssetContent)? {
    host { CustomContentBox.content(of: raw) }
  }

  /// The asset's custom content, when this plugin set it as a `T`.
  public func customContent<T: AssetContent>(as type: T.Type) -> T? {
    customContent as? T
  }
}

@available(*, unavailable, message: "an Asset may only be used from the transform call's own task")
extension Asset: Sendable {}
