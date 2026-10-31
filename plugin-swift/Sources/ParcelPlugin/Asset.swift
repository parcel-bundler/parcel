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
/// asset.setContent("export default 42;")
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

  /// Reads the asset's content as UTF-8 text. Throws when it cannot be read, or
  /// is not valid UTF-8, a ``Diagnostic`` to rethrow as is: Parcel then reports
  /// why exactly as it determined it. Set it with ``setContent(_:sourceMap:)-(String,_)``.
  public func content() throws -> String {
    try host { Result { try readContent(raw, options: options.raw) } }.get()
  }

  /// Reads the asset's content as bytes. Throws like ``content()``. Set it with
  /// ``setContent(_:sourceMap:)-(DataProtocol,_)``.
  public func contentBytes() throws -> [UInt8] {
    try host { Result { try readContentBytes(raw, options: options.raw) } }.get()
  }

  /// Replaces the content with text, optionally along with a JSON (v3) source
  /// map describing it.
  ///
  /// The map's sources may be absolute paths, `file://` URLs, or paths relative
  /// to the asset's directory. Parcel composes it with the maps of later
  /// transformers, so the final bundle maps back to the files this one read.
  public func setContent(_ content: String, sourceMap: String? = nil) {
    host {
      withBytes(content) { data, count in
        if let sourceMap {
          withBytes(sourceMap) { map, mapCount in
            parcel_asset_set_content_utf8(raw, data, count, map, mapCount)
          }
        } else {
          parcel_asset_set_content_utf8(raw, data, count, nil, 0)
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
            parcel_asset_set_content(raw, data, count, map, mapCount)
          }
        } else {
          parcel_asset_set_content(raw, data, count, nil, 0)
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

  public var dependencyCount: Int {
    host { Int(parcel_asset_get_dependency_count(raw)) }
  }

  /// The dependency at `index`, or `nil` when it is out of range. It is invalid
  /// after the next ``addDependency(_:)``.
  public func dependency(at index: Int) -> Dependency? {
    guard index >= 0 else { return nil }
    let dependency = host { parcel_asset_get_dependency(raw, UInt(index)) }
    guard dependency != 0 else { return nil }
    return Dependency(raw: dependency, options: options)
  }

  /// The asset's dependencies so far: those earlier transformers added, and this
  /// one. They are invalid after the next ``addDependency(_:)``.
  public var dependencies: [Dependency] {
    (0..<dependencyCount).compactMap { dependency(at: $0) }
  }

  /// Adds a dependency to the asset. It inherits the asset's target.
  ///
  /// Throws when Parcel cannot honor `dependency`, e.g. because it uses a
  /// ``SpecifierType``, ``Priority``, ``BundleBehavior``, or ``ImportType``
  /// value this version of Parcel does not support.
  public func addDependency(_ dependency: DependencyOptions) throws(Diagnostic) {
    let added = host { dependency.withRaw { parcel_asset_add_dependency(raw, $0) } }
    guard added else {
      let specifier = String(reflecting: dependency.specifier)
      throw Diagnostic(
        "Parcel could not add the dependency \(specifier): it uses an option this version of "
          + "Parcel does not support.")
    }
  }

  /// Adds a dependency on `specifier` to the asset. See ``addDependency(_:)``.
  public func addDependency(
    _ specifier: String,
    specifierType: SpecifierType = .esm,
    priority: Priority = .sync,
    bundleBehavior: BundleBehavior = .none,
    flags: DependencyFlags = [],
    conditions: ExportsConditions = [],
    importType: ImportType = .javaScript
  ) throws(Diagnostic) {
    try addDependency(
      DependencyOptions(
        specifier, specifierType: specifierType, priority: priority,
        bundleBehavior: bundleBehavior, flags: flags, conditions: conditions,
        importType: importType))
  }

  /// Resolves `dependency` with the configured resolvers, exactly as if it had
  /// been added with ``addDependency(_:)``, without adding it.
  ///
  /// `from` is the absolute path of the file containing the import, when that is
  /// not the asset itself, e.g. a Sass partial the asset pulled in. Every file
  /// the resolvers read or probe invalidates the asset, so the transform re-runs
  /// when the result would change.
  ///
  /// Returns ``ResolveResult/unresolved`` when no resolver claimed the
  /// dependency. Throws when one failed, with the diagnostics it reported, which
  /// rethrowing reports unchanged, or when Parcel cannot honor `dependency` (see
  /// ``addDependency(_:)``).
  public func resolve(_ dependency: DependencyOptions, from: String? = nil) throws(Diagnostic)
    -> ResolveResult
  {
    let failed = "Could not resolve \"\(dependency.specifier)\""
    var diagnostics: UInt64 = 0
    var resolved = false
    let resolution: ResolveResult? = host {
      withSized(CParcelABI.ResolveResult.self) { result in
        resolved = dependency.withRaw { dep in
          withBytes(from ?? "") {
            parcel_asset_resolve(raw, options.raw, dep, $0, $1, result, &diagnostics)
          }
        }
        let filePath = takeString(&result.pointee.file_path)
        let pipeline = takeString(&result.pointee.pipeline)
        guard resolved else { return nil }
        switch result.pointee.resolution_type {
        case 0: return .unresolved
        case 1: return filePath.map { .file($0, pipeline: pipeline) }
        case 2: return .external
        case 3: return .excluded
        // A kind of resolution this SDK predates, which a plugin cannot act on.
        default: return nil
        }
      }
    }
    guard resolved else {
      throw Diagnostic(parcelDiagnostics: diagnostics, fallback: failed)
    }
    guard let resolution else { throw Diagnostic(failed) }
    return resolution
  }

  /// Resolves `specifier` as an ES module import. See ``resolve(_:from:)-(DependencyOptions,_)``.
  public func resolve(_ specifier: String, from: String? = nil) throws(Diagnostic)
    -> ResolveResult
  {
    try resolve(DependencyOptions(specifier), from: from)
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

/// Reads an asset's content as UTF-8 text, throwing the diagnostics Parcel
/// reported when it cannot.
func readContent(_ asset: UInt64, options: UInt64) throws -> String {
  var buffer = CParcelABI.Buffer()
  var diagnostics: UInt64 = 0
  guard parcel_asset_get_content_utf8(&buffer, asset, options, &diagnostics) else {
    throw Diagnostic(parcelDiagnostics: diagnostics)
  }
  return takeString(&buffer) ?? ""
}

/// Reads an asset's content as bytes, throwing the diagnostics Parcel reported
/// when it cannot.
func readContentBytes(_ asset: UInt64, options: UInt64) throws -> [UInt8] {
  var buffer = CParcelABI.Buffer()
  var diagnostics: UInt64 = 0
  guard parcel_asset_get_content(&buffer, asset, options, &diagnostics) else {
    throw Diagnostic(parcelDiagnostics: diagnostics)
  }
  return takeBytes(&buffer) ?? []
}
