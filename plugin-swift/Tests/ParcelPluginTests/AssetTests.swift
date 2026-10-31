import CParcelABI
import Dispatch
import Foundation
import Synchronization
import Testing

@testable import ParcelPlugin

/// What the mock host saw a setter call with.
struct SetContentCall: Equatable {
  var function: String
  var content: [UInt8]
  var sourceMap: [UInt8]?
}

private let calls = Mutex<[UInt64: SetContentCall]>([:])

private func record(
  _ function: String, _ asset: UInt64, _ data: UnsafePointer<UInt8>?, _ count: Int,
  _ map: UnsafePointer<UInt8>? = nil, _ mapCount: Int = 0
) {
  let content = data.map { Array(UnsafeBufferPointer(start: $0, count: count)) } ?? []
  let sourceMap = map.map { Array(UnsafeBufferPointer(start: $0, count: mapCount)) }
  calls.withLock {
    $0[asset] = SetContentCall(function: function, content: content, sourceMap: sourceMap)
  }
}

/// A host table implementing just the content setters. The SDK accepts one
/// table per process, so every test shares this one, and tells its calls apart
/// by asset handle.
nonisolated(unsafe) private let mockAPI: UnsafeMutablePointer<ParcelApi> = {
  let api = UnsafeMutablePointer<ParcelApi>.allocate(capacity: 1)
  api.initialize(to: ParcelApi())
  api.pointee.header.size = UInt(MemoryLayout<ParcelApi>.size)
  api.pointee.header.abi = UInt32(PARCEL_ABI_VERSION)
  api.pointee.asset_set_content = { record("set_content", $0, $1, Int($2), $3, Int($4)) }
  api.pointee.asset_set_content_utf8 = {
    record("set_content_utf8", $0, $1, Int($2), $3, Int($4))
  }
  api.pointee.asset_get_map = { buffer, asset in
    guard let buffer, let map = sourceMaps.withLock({ $0[asset] }) else { return }
    let bytes = Array(map.utf8)
    let data = UnsafeMutablePointer<UInt8>.allocate(capacity: bytes.count)
    data.initialize(from: bytes, count: bytes.count)
    buffer.pointee = Buffer(data: data, len: UInt(bytes.count), cap: UInt(bytes.count), is_utf8: true)
  }
  api.pointee.free_buffer = { buffer in
    guard let buffer else { return }
    buffer.pointee.data?.deallocate()
    buffer.pointee = Buffer()
  }
  // Like Parcel, rejects a dependency with an unset size, or one using an option
  // it "does not support", here spelled as the specifier "unsupported".
  api.pointee.asset_add_dependency = { asset, dep in
    guard let dep else { return false }
    sizedStructs.withLock { $0[asset] = rawBytes(of: dep) }
    let specifier = decodeString(dep.pointee.specifier, Int(dep.pointee.specifier_len))
    return dep.pointee.size >= UInt(MemoryLayout<CParcelABI.DependencyOptions>.size)
      && specifier != "unsupported"
  }
  // Resolves to the resolution type in `resolutionTypes` for the asset, and
  // fails for `failedResolution`, handing out `resolveDiagnostics`.
  api.pointee.asset_resolve = { asset, _, dep, _, _, result, diagnostics in
    guard let dep, let result else { return false }
    sizedStructs.withLock { $0[asset] = rawBytes(of: result) }
    guard dep.pointee.size >= UInt(MemoryLayout<CParcelABI.DependencyOptions>.size) else {
      return false
    }
    let resolution = resolutionTypes.withLock { $0[asset] } ?? 0
    if resolution == failedResolution {
      diagnostics?.pointee = resolveDiagnostics
      return false
    }
    result.pointee.resolution_type = resolution
    return true
  }
  api.pointee.diagnostic_get_message = { buffer, diagnostics, index in
    guard let buffer, diagnostics == resolveDiagnostics, index == 0 else { return }
    buffer.pointee = hostBuffer(resolveFailure)
  }
  // Answers from the handles it is given: a dependency's import type is its
  // handle, each asset has `dependencyCounts` dependencies, each the handle
  // 100 + its index, and the options handle is the log level, with HMR enabled
  // for verbose.
  api.pointee.dep_get_import_type = { UInt8(truncatingIfNeeded: $0) }
  api.pointee.asset_get_dependency_count = { asset in
    UInt(dependencyCounts.withLock { $0[asset] } ?? 0)
  }
  api.pointee.asset_get_dependency = { asset, index in
    index < UInt(dependencyCounts.withLock { $0[asset] } ?? 0) ? 100 + UInt64(index) : 0
  }
  api.pointee.options_get_mode = { buffer, _ in buffer?.pointee = hostBuffer("staging") }
  api.pointee.options_get_hmr = { $0 == UInt64(PARCEL_LOG_VERBOSE.rawValue) }
  api.pointee.options_get_log_level = { UInt8(truncatingIfNeeded: $0) }
  // Resolves each dependency to the resolution type equal to its index.
  api.pointee.bundle_graph_get_dependency_resolution = { resolution, graph, asset, index in
    guard let resolution else { return }
    sizedStructs.withLock { $0[graph] = rawBytes(of: resolution) }
    resolution.pointee.resolution_type = UInt8(truncatingIfNeeded: index)
    resolution.pointee.asset = asset
  }
  return api
}()

/// The bytes of the last sized struct the mock host was handed, by asset or
/// bundle graph handle.
private let sizedStructs = Mutex<[UInt64: [UInt8]]>([:])

/// The resolution type `Asset.resolve` gets for each asset handle.
private let resolutionTypes = Mutex<[UInt64: UInt8]>([:])

/// The resolution type for which the mock host's resolve fails, handing out
/// `resolveDiagnostics`, whose one diagnostic says `resolveFailure`.
private let failedResolution: UInt8 = 250
private let resolveDiagnostics: UInt64 = 7
private let resolveFailure = "the resolver failed"

/// How many dependencies the mock host gives each asset handle.
private let dependencyCounts = Mutex<[UInt64: Int]>([:])

/// A buffer holding `string`, which the mock host's `free_buffer` frees.
private func hostBuffer(_ string: String) -> Buffer {
  let bytes = Array(string.utf8)
  let data = UnsafeMutablePointer<UInt8>.allocate(capacity: bytes.count)
  data.initialize(from: bytes, count: bytes.count)
  return Buffer(data: data, len: UInt(bytes.count), cap: UInt(bytes.count), is_utf8: true)
}

private func rawBytes<T>(of pointer: UnsafePointer<T>) -> [UInt8] {
  Array(UnsafeRawBufferPointer(start: pointer, count: MemoryLayout<T>.size))
}

private func rawBytes<T>(of pointer: UnsafeMutablePointer<T>) -> [UInt8] {
  rawBytes(of: UnsafePointer(pointer))
}

/// The source map the mock host returns for each asset handle; none for the rest.
private let sourceMaps = Mutex<[UInt64: String]>([:])

private let nextHandle = Atomic<UInt64>(1)

/// Runs `body` with an asset backed by the mock host, whose source map is
/// `sourceMap`, and returns what it returns.
private func withAsset<R>(sourceMap: String?, _ body: (ParcelPlugin.Asset) -> R) -> R {
  #expect(installAPI(UnsafeRawPointer(mockAPI)))
  let handle = nextHandle.add(1, ordering: .relaxed).newValue
  sourceMaps.withLock { $0[handle] = sourceMap }
  let scope = CallScope("transform")
  defer { scope.close() }
  return body(ParcelPlugin.Asset(raw: handle, options: ParcelPlugin.Options(raw: 1, scope: scope)))
}

/// Runs `body` with an asset backed by the mock host and that asset's handle,
/// and returns what it returns.
private func withAssetHandle<R>(_ body: (ParcelPlugin.Asset, UInt64) throws -> R) rethrows -> R {
  #expect(installAPI(UnsafeRawPointer(mockAPI)))
  let handle = nextHandle.add(1, ordering: .relaxed).newValue
  let scope = CallScope("transform")
  defer { scope.close() }
  return try body(
    ParcelPlugin.Asset(raw: handle, options: ParcelPlugin.Options(raw: 1, scope: scope)), handle)
}

/// Runs `body` with an asset backed by the mock host, and returns the setter
/// call it made.
private func setContent(_ body: (ParcelPlugin.Asset) -> Void) -> SetContentCall? {
  #expect(installAPI(UnsafeRawPointer(mockAPI)))
  let handle = nextHandle.add(1, ordering: .relaxed).newValue
  let scope = CallScope("transform")
  body(ParcelPlugin.Asset(raw: handle, options: ParcelPlugin.Options(raw: 1, scope: scope)))
  scope.close()
  return calls.withLock { $0[handle] }
}

@Suite struct AssetContentTests {
  let bytes: [UInt8] = [0, 1, 2, 0xff]

  @Test func bytesFromAnArray() {
    #expect(
      setContent { $0.setContent(bytes) }
        == SetContentCall(function: "set_content", content: bytes))
  }

  @Test func bytesFromALiteral() {
    #expect(
      setContent { $0.setContent([0, 1, 2, 0xff]) }
        == SetContentCall(function: "set_content", content: bytes))
  }

  @Test func bytesFromData() {
    #expect(
      setContent { $0.setContent(Data(bytes)) }
        == SetContentCall(function: "set_content", content: bytes))
  }

  @Test func bytesFromASlice() {
    #expect(
      setContent { $0.setContent(Data(bytes)[1...]) }
        == SetContentCall(function: "set_content", content: Array(bytes[1...])))
  }

  /// Not contiguous, so it is flattened before it reaches the host.
  @Test func bytesFromDispatchDataWithSeveralRegions() {
    var data = DispatchData.empty
    bytes[..<2].withUnsafeBytes { data.append($0) }
    bytes[2...].withUnsafeBytes { data.append($0) }
    #expect(
      setContent { $0.setContent(data) }
        == SetContentCall(function: "set_content", content: bytes))
  }

  @Test func bytesWithASourceMap() {
    #expect(
      setContent { $0.setContent(Data(bytes), sourceMap: "{}") }
        == SetContentCall(
          function: "set_content", content: bytes, sourceMap: Array("{}".utf8)))
  }

  @Test func emptyBytesStillEmptyTheAsset() {
    #expect(
      setContent { $0.setContent(Data()) }
        == SetContentCall(function: "set_content", content: []))
  }

  @Test func text() {
    #expect(
      setContent { $0.setContent("héllo") }
        == SetContentCall(function: "set_content_utf8", content: Array("héllo".utf8)))
  }

  @Test func textWithASourceMap() {
    #expect(
      setContent { $0.setContent("a", sourceMap: "{}") }
        == SetContentCall(
          function: "set_content_utf8", content: Array("a".utf8),
          sourceMap: Array("{}".utf8)))
  }
}

@Suite struct AssetSourceMapTests {
  @Test func returnsTheHostMap() {
    let map = #"{"version":3,"sources":["a.ts"],"mappings":"AAAA"}"#
    #expect(withAsset(sourceMap: map) { $0.sourceMap } == map)
  }

  @Test func isNilWithoutAMap() {
    #expect(withAsset(sourceMap: nil) { $0.sourceMap } == nil)
  }

  /// Read-only assets, as namers, optimizers and reporters get them, have it too.
  @Test func assetViewReturnsTheHostMap() {
    let map = #"{"version":3,"sources":["a.ts"],"mappings":"AAAA"}"#
    let view = withAsset(sourceMap: map) { asset in
      AssetView(raw: asset.raw, index: 0, options: asset.options).sourceMap
    }
    #expect(view == map)
  }
}

@Suite struct ByteContainerTests {
  /// Contiguous containers reach the host without a copy.
  @Test func contiguousBytesAreNotCopied() {
    let array: [UInt8] = [1, 2, 3]
    let arrayAddress = array.withUnsafeBufferPointer { $0.baseAddress }
    #expect(withBytes(array) { pointer, _ in pointer } == arrayAddress)

    let data = Data(repeating: 7, count: 64)
    let dataAddress = data.withUnsafeBytes { $0.bindMemory(to: UInt8.self).baseAddress }
    #expect(withBytes(data) { pointer, _ in pointer } == dataAddress)
  }
}

/// Structs passed by pointer start with `size`, and are zeroed, padding included,
/// when the SDK allocates them.
@Suite struct SizedStructTests {
  /// Parcel compares `size` with C's `sizeof`, which includes tail padding.
  @Test func sizesMatchC() {
    func matches<T>(_: T.Type) -> Bool { MemoryLayout<T>.size == MemoryLayout<T>.stride }
    #expect(matches(CParcelABI.DependencyOptions.self))
    #expect(matches(CParcelABI.ResolveResult.self))
    #expect(matches(CParcelABI.OptimizeResult.self))
    #expect(matches(CParcelABI.DiagnosticOptions.self))
    #expect(matches(CParcelABI.BundleGraphDependencyResolution.self))
    #expect(matches(CParcelABI.ReportEvent.self))
    #if arch(arm64) || arch(x86_64)
      #expect(MemoryLayout<CParcelABI.DependencyOptions>.size == 40)
    #endif
  }

  @Test func addDependencyPassesAZeroedSizedStruct() throws {
    let bytes = try withAssetHandle { asset, handle in
      try asset.addDependency("./a.js", priority: .lazy, flags: .optional, importType: .url)
      return sizedStructs.withLock { $0[handle] } ?? []
    }
    try #require(bytes.count == MemoryLayout<CParcelABI.DependencyOptions>.size)
    let raw = bytes.withUnsafeBytes { $0.loadUnaligned(as: CParcelABI.DependencyOptions.self) }
    #expect(raw.size == UInt(MemoryLayout<CParcelABI.DependencyOptions>.size))
    #expect(raw.priority == ParcelPlugin.Priority.lazy.rawValue)
    #expect(raw.flags == DependencyFlags.optional.rawValue)
    #expect(raw.import_type == ImportType.url.rawValue)
    // The tail padding, where a field a newer header adds would go.
    let end = MemoryLayout<CParcelABI.DependencyOptions>.offset(of: \.import_type)! + 1
    #expect(bytes[end...].allSatisfy { $0 == 0 })
  }

  @Test func addDependencyThrowsWhenParcelRejectsIt() {
    _ = withAssetHandle { asset, _ in
      #expect {
        try asset.addDependency("unsupported")
      } throws: { error in
        (error as? ParcelPlugin.Diagnostic)?.message.contains(#""unsupported""#) == true
      }
    }
  }

  @Test func resolveSizesItsResult() {
    let (result, bytes) = withAssetHandle { asset, handle in
      resolutionTypes.withLock { $0[handle] = UInt8(PARCEL_RESOLUTION_EXTERNAL.rawValue) }
      return (try? asset.resolve("./a.js"), sizedStructs.withLock { $0[handle] } ?? [])
    }
    #expect(result == .external)
    let size = bytes.withUnsafeBytes { $0.loadUnaligned(as: UInt.self) }
    #expect(size == UInt(MemoryLayout<CParcelABI.ResolveResult>.size))
  }

  /// A kind of resolution this SDK predates, which a plugin cannot act on.
  @Test func resolveFailsOnAnUnknownResolution() {
    let result = withAssetHandle { asset, handle in
      resolutionTypes.withLock { $0[handle] = 200 }
      return Result { () throws(ParcelPlugin.Diagnostic) in try asset.resolve("./a.js") }
    }
    #expect(throws: ParcelPlugin.Diagnostic.self) { try result.get() }
  }

  @Test func resolveFailureCarriesParcelDiagnostics() {
    let result = withAssetHandle { asset, handle in
      resolutionTypes.withLock { $0[handle] = failedResolution }
      return Result { () throws(ParcelPlugin.Diagnostic) in try asset.resolve("./a.js") }
    }
    #expect {
      try result.get()
    } throws: { error in
      let diagnostic = error as? ParcelPlugin.Diagnostic
      // Thrown from a plugin method, it fails with exactly Parcel's diagnostics.
      return diagnostic?.message == resolveFailure
        && diagnostic?.parcelDiagnostics == resolveDiagnostics
    }
  }

  @Test func transformerAssetDependencies() {
    let handles = withAssetHandle { asset, handle in
      dependencyCounts.withLock { $0[handle] = 3 }
      return asset.dependencies.map(\.raw)
    }
    #expect(handles == [100, 101, 102])
  }

  @Test func dependencyImportType() {
    #expect(installAPI(UnsafeRawPointer(mockAPI)))
    let scope = CallScope("resolve")
    defer { scope.close() }
    let options = ParcelPlugin.Options(raw: 1, scope: scope)
    for importType in [ImportType.javaScript, .styleSheet, .url, .text, .bytes] {
      let dependency = ParcelPlugin.Dependency(raw: UInt64(importType.rawValue), options: options)
      #expect(dependency.importType == importType)
    }
  }

  @Test func optionsModeHMRAndLogLevel() {
    #expect(installAPI(UnsafeRawPointer(mockAPI)))
    let scope = CallScope("transform")
    defer { scope.close() }
    let verbose = ParcelPlugin.Options(raw: UInt64(LogLevel.verbose.rawValue), scope: scope)
    let warn = ParcelPlugin.Options(raw: UInt64(LogLevel.warn.rawValue), scope: scope)
    #expect(verbose.mode == BuildMode(rawValue: "staging"))
    #expect(verbose.hmr && !warn.hmr)
    #expect(warn.logLevel == .warn)
  }

  @Test func resolveReportsUnresolved() {
    let result = withAssetHandle { asset, handle in
      resolutionTypes.withLock { $0[handle] = UInt8(PARCEL_RESOLUTION_NONE.rawValue) }
      return try? asset.resolve("./a.js")
    }
    #expect(result == .unresolved)
  }

  @Test func bundleGraphResolutions() {
    #expect(installAPI(UnsafeRawPointer(mockAPI)))
    let handle = nextHandle.add(1, ordering: .relaxed).newValue
    let scope = CallScope("report")
    defer { scope.close() }
    let graph = ParcelPlugin.BundleGraph(
      raw: handle, options: ParcelPlugin.Options(raw: 1, scope: scope))

    let asset = Int(PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET.rawValue)
    #expect(graph.resolution(ofDependency: asset, of: 3) == .asset(3))
    let size = sizedStructs.withLock { $0[handle] }?.withUnsafeBytes {
      $0.loadUnaligned(as: UInt.self)
    }
    #expect(size == UInt(MemoryLayout<CParcelABI.BundleGraphDependencyResolution>.size))

    // A kind of resolution this SDK predates.
    #expect(graph.resolution(ofDependency: 200, of: 3) == .invalid)
    #expect(graph.resolution(ofDependency: -1, of: 3) == .invalid)
  }

  /// A struct Parcel filled in is read up to its `size`.
  @Test func readSizedHonorsTheReportedSize() {
    let full = MemoryLayout<CParcelABI.DiagnosticOptions>.size
    let line = MemoryLayout<CParcelABI.DiagnosticOptions>.offset(of: \.line)!
    // Twice the size, as a newer Parcel with more fields might pass.
    var bytes = [UInt8](repeating: 0xab, count: full * 2)

    func read(size: Int, minSize: Int) -> CParcelABI.DiagnosticOptions? {
      bytes.withUnsafeMutableBytes { buffer in
        buffer.storeBytes(of: UInt(size), as: UInt.self)
        return readSized(
          UnsafeRawPointer(buffer.baseAddress!), as: CParcelABI.DiagnosticOptions.self, minSize: minSize)
      }
    }

    // Unset, or too small to hold the fields the caller needs.
    #expect(read(size: 0, minSize: line) == nil)
    #expect(read(size: line - 1, minSize: line) == nil)

    // An older, smaller struct: the fields past `size` read as zero.
    let older = read(size: line, minSize: line)
    #expect(older?.size == UInt(line))
    #expect(older?.message.len == 0xabab_abab_abab_abab)
    #expect(older?.line == 0)
    #expect(older?.severity == 0)

    // A newer, larger struct: only the fields this SDK knows are read.
    let newer = read(size: full * 2, minSize: line)
    #expect(newer?.size == UInt(full * 2))
    #expect(newer?.line == 0xabab_abab)
  }
}
