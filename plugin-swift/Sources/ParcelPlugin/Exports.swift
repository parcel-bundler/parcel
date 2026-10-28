internal import CParcelABI

#if canImport(FoundationEssentials)
  import FoundationEssentials
#else
  import Foundation
#endif

/// The implementations of the C entry points Parcel calls, which
/// ``parcelPlugin(_:)`` exports for `P`.
///
/// Each entry point runs the plugin method as a task on the calling thread (see
/// ``Plugin``), and closes the handles it passed in before returning. Use the
/// macro rather than calling these; they are public only so its expansion can.
public enum PluginExports<P: Plugin> {
  // ── Init ─────────────────────────────────────────────────────────────────

  public static func initialize(
    _ api: UnsafeRawPointer?,
    _ config: UnsafePointer<UInt8>?,
    _ configLength: Int,
    _ state: UnsafeMutablePointer<UnsafeMutableRawPointer?>?,
    _ diagnostic: UnsafeMutableRawPointer?
  ) -> UInt8 {
    // Must come first: every other SDK call, including writing a diagnostic,
    // goes through this table. Parcel describes the mismatch itself.
    guard installAPI(api) else {
      return 2  // PARCEL_INIT_INCOMPATIBLE
    }

    let json: [UInt8] =
      if let config, configLength > 0 {
        Array(UnsafeBufferPointer(start: config, count: configLength))
      } else {
        Array("{}".utf8)
      }
    let result = runOnHostThread { () async throws -> PluginState in
      let config = try JSONDecoder().decode(P.Config.self, from: Data(json))
      return PluginState(try await P(config: config))
    }

    switch result {
    case .success(let plugin):
      state?.pointee = Unmanaged.passRetained(plugin).toOpaque()
      return 0  // PARCEL_INIT_OK
    case .failure(let error):
      reportError(error, to: diagnostic)
      return 1  // PARCEL_INIT_ERROR
    }
  }

  public static func deinitialize(_ state: UnsafeMutableRawPointer?) {
    guard let state else { return }
    Unmanaged<PluginState>.fromOpaque(state).release()
  }

  // ── Transform ────────────────────────────────────────────────────────────

  public static func transform(
    _ asset: UInt64,
    _ options: UInt64,
    _ state: UnsafeMutableRawPointer?,
    _ diagnostic: UnsafeMutableRawPointer?
  ) {
    guard let transformer = role(state, diagnostic, \.transformer, "a transformer") else { return }
    let scope = CallScope("transform")
    defer { scope.close() }

    let result = runOnHostThread {
      let options = Options(raw: options, scope: scope)
      try await transformer.transform(Asset(raw: asset, options: options), options: options)
    }
    if case .failure(let error) = result {
      reportError(error, to: diagnostic)
    }
  }

  // ── Resolve ──────────────────────────────────────────────────────────────

  public static func resolve(
    _ dependency: UInt64,
    _ specifier: UnsafePointer<UInt8>?,
    _ specifierLength: Int,
    _ pipeline: UnsafePointer<UInt8>?,
    _ pipelineLength: Int,
    _ options: UInt64,
    _ output: UnsafeMutableRawPointer?,
    _ state: UnsafeMutableRawPointer?,
    _ diagnostic: UnsafeMutableRawPointer?
  ) {
    guard let resolver = role(state, diagnostic, \.resolver, "a resolver") else { return }
    let specifier = decodeString(specifier, specifierLength)
    let pipeline = pipeline.map { decodeString($0, pipelineLength) }
    let scope = CallScope("resolve")
    defer { scope.close() }

    let result = runOnHostThread {
      let options = Options(raw: options, scope: scope)
      return try await resolver.resolve(
        Dependency(raw: dependency, options: options), specifier: specifier, pipeline: pipeline,
        options: options)
    }

    switch result {
    case .success(let resolution):
      guard let output = output?.assumingMemoryBound(to: CParcelABI.ResolveResult.self) else {
        return
      }
      // Parcel allocated and sized this, so it is written field by field. Every
      // field here is in the first layout; one added later must check `size` first.
      switch resolution {
      case nil:
        output.pointee.resolution_type = 0
      case .resolved(let filePath, let pipeline)?:
        output.pointee.resolution_type = 1
        output.pointee.file_path = allocBuffer(filePath)
        if let pipeline, !pipeline.isEmpty {
          output.pointee.pipeline = allocBuffer(pipeline)
        }
      case .external?:
        output.pointee.resolution_type = 2
      case .excluded?:
        output.pointee.resolution_type = 3
      }
    case .failure(let error):
      reportError(error, to: diagnostic)
    }
  }

  // ── Name ─────────────────────────────────────────────────────────────────

  public static func name(
    _ bundleGraph: UInt64,
    _ bundle: UInt64,
    _ options: UInt64,
    _ output: UnsafeMutableRawPointer?,
    _ state: UnsafeMutableRawPointer?,
    _ diagnostic: UnsafeMutableRawPointer?
  ) {
    guard let namer = role(state, diagnostic, \.namer, "a namer") else { return }
    let scope = CallScope("name")
    defer { scope.close() }

    let result = runOnHostThread {
      let options = Options(raw: options, scope: scope)
      return try await namer.name(
        OutputBundle(raw: bundle, options: options),
        in: BundleGraph(raw: bundleGraph, options: options), options: options)
    }

    switch result {
    case .success(let name):
      if let name, !name.isEmpty,
        let output = output?.assumingMemoryBound(to: CParcelABI.Buffer.self)
      {
        withBytes(name) { parcel_buffer_write_utf8(output, $0, $1) }
      }
    case .failure(let error):
      reportError(error, to: diagnostic)
    }
  }

  // ── Optimize ─────────────────────────────────────────────────────────────

  public static func optimize(
    _ bundleGraph: UInt64,
    _ bundle: UInt64,
    _ contents: UnsafePointer<UInt8>?,
    _ contentsLength: Int,
    _ sourceMap: UnsafePointer<UInt8>?,
    _ sourceMapLength: Int,
    _ options: UInt64,
    _ output: UnsafeMutableRawPointer?,
    _ state: UnsafeMutableRawPointer?,
    _ diagnostic: UnsafeMutableRawPointer?
  ) {
    guard let optimizer = role(state, diagnostic, \.optimizer, "an optimizer") else { return }
    let contents =
      contents.map { Array(UnsafeBufferPointer(start: $0, count: contentsLength)) } ?? []
    // A null pointer means no source map; a non-null empty one is an empty map.
    let sourceMap = sourceMap.map { Array(UnsafeBufferPointer(start: $0, count: sourceMapLength)) }
    let scope = CallScope("optimize")
    defer { scope.close() }

    let result = runOnHostThread {
      let options = Options(raw: options, scope: scope)
      return try await optimizer.optimize(
        OutputBundle(raw: bundle, options: options),
        in: BundleGraph(raw: bundleGraph, options: options), contents: contents,
        sourceMap: sourceMap, options: options)
    }

    switch result {
    case .success(let optimized):
      guard let output = output?.assumingMemoryBound(to: CParcelABI.OptimizeResult.self) else {
        return
      }
      // Parcel allocated and sized this, so it is written field by field. Every
      // field here is in the first layout; one added later must check `size` first.
      write(optimized.contents, to: &output.pointee.contents)
      if let sourceMap = optimized.sourceMap {
        withBytes(sourceMap) { parcel_buffer_write(&output.pointee.source_map, $0, $1) }
      }
    case .failure(let error):
      reportError(error, to: diagnostic)
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────

  public static func report(
    _ event: UnsafeRawPointer?,
    _ options: UInt64,
    _ state: UnsafeMutableRawPointer?,
    _ diagnostic: UnsafeMutableRawPointer?
  ) {
    // Read up to the size Parcel reported. Every field read here is in the first layout,
    // so an event too small to hold them all is not one this SDK can read.
    let minSize =
      MemoryLayout<CParcelABI.ReportEvent>.offset(of: \.changed_asset_count)!
      + MemoryLayout<UInt>.size
    guard let event, let event = readSized(event, as: CParcelABI.ReportEvent.self, minSize: minSize)
    else {
      return
    }
    guard let reporter = role(state, diagnostic, \.reporter, "a reporter") else { return }
    let scope = CallScope("report")
    defer { scope.close() }

    let diagnostics = Diagnostics(raw: event.diagnostics, scope: scope)
    let changedAssets: [AssetIndex] =
      if let changed = event.changed_assets, event.changed_asset_count > 0 {
        Array(UnsafeBufferPointer(start: changed, count: Int(event.changed_asset_count)))
      } else {
        []
      }
    let message = event.message.map { decodeString($0, Int(event.message_len)) }
    let (eventType, level) = (event.event_type, LogLevel(rawValue: event.level))
    let (bundleGraph, buildTime) = (
      event.bundle_graph, Duration.milliseconds(Int64(event.build_time_ms))
    )

    let result = runOnHostThread { () async throws -> Void in
      let options = Options(raw: options, scope: scope)
      switch eventType {
      case 0:
        try await reporter.buildStarted(options: options)
      case 1:
        let build = BuildSuccess(
          bundleGraph: BundleGraph(raw: bundleGraph, options: options),
          buildTime: buildTime,
          changedAssets: changedAssets)
        try await reporter.buildSucceeded(build, options: options)
      case 2:
        try await reporter.buildFailed(diagnostics, options: options)
      case 3:
        let entry = LogEntry(
          level: level,
          message: message.map { .text($0) } ?? .diagnostics(diagnostics))
        try await reporter.log(entry, options: options)
      default:
        // An event added to Parcel after this SDK was built. Reporting nothing
        // beats reporting it as the wrong kind of event.
        break
      }
    }
    if case .failure(let error) = result {
      reportError(error, to: diagnostic)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /// The plugin's conformance to the protocol for an entry point, or a
  /// diagnostic saying it has none: the `.parcelrc` uses it for something it is
  /// not.
  private static func role<R>(
    _ state: UnsafeMutableRawPointer?,
    _ diagnostic: UnsafeMutableRawPointer?,
    _ role: KeyPath<PluginState, R?>,
    _ description: String
  ) -> R? {
    guard let state else {
      reportError(Diagnostic("plugin was not initialized"), to: diagnostic)
      return nil
    }
    let plugin = Unmanaged<PluginState>.fromOpaque(state).takeUnretainedValue()
    guard let conformance = plugin[keyPath: role] else {
      reportError(
        Diagnostic(
          "\(plugin.typeName) is configured as \(description), but is not one",
          hint: "Conform \(plugin.typeName) to \(Self.protocolName(description))."),
        to: diagnostic)
      return nil
    }
    return conformance
  }

  private static func protocolName(_ description: String) -> String {
    switch description {
    case "a transformer": "Transformer"
    case "a resolver": "Resolver"
    case "a namer": "Namer"
    case "an optimizer": "Optimizer"
    default: "Reporter"
    }
  }
}

/// A plugin instance, with its conformances looked up once.
final class PluginState: Sendable {
  let typeName: String
  let transformer: (any Transformer)?
  let resolver: (any Resolver)?
  let namer: (any Namer)?
  let optimizer: (any Optimizer)?
  let reporter: (any Reporter)?

  init(_ plugin: some Plugin) {
    typeName = String(describing: type(of: plugin))
    transformer = plugin as? any Transformer
    resolver = plugin as? any Resolver
    namer = plugin as? any Namer
    optimizer = plugin as? any Optimizer
    reporter = plugin as? any Reporter
  }
}
