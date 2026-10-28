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
  api.pointee.asset_set_content = { record("set_content", $0, $1, Int($2)) }
  api.pointee.asset_set_content_utf8 = { record("set_content_utf8", $0, $1, Int($2)) }
  api.pointee.asset_set_content_with_map = {
    record("set_content_with_map", $0, $1, Int($2), $3, Int($4))
  }
  api.pointee.asset_set_content_utf8_with_map = {
    record("set_content_utf8_with_map", $0, $1, Int($2), $3, Int($4))
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
  // Resolves to the resolution type in `resolutionTypes` for the asset.
  api.pointee.asset_resolve = { asset, _, dep, _, _, result in
    guard let dep, let result else { return false }
    sizedStructs.withLock { $0[asset] = rawBytes(of: result) }
    guard dep.pointee.size >= UInt(MemoryLayout<CParcelABI.DependencyOptions>.size) else {
      return false
    }
    result.pointee.resolution_type = resolutionTypes.withLock { $0[asset] } ?? 0
    return true
  }
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
          function: "set_content_with_map", content: bytes, sourceMap: Array("{}".utf8)))
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
    #expect(
      setContent { $0.content = "héllo" }
        == SetContentCall(function: "set_content_utf8", content: Array("héllo".utf8)))
  }

  @Test func textWithASourceMap() {
    #expect(
      setContent { $0.setContent("a", sourceMap: "{}") }
        == SetContentCall(
          function: "set_content_utf8_with_map", content: Array("a".utf8),
          sourceMap: Array("{}".utf8)))
  }

  @Test func contentBytesProperty() {
    #expect(
      setContent { $0.contentBytes = bytes }
        == SetContentCall(function: "set_content", content: bytes))
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
    #expect(matches(CParcelABI.Diagnostic.self))
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
      return (asset.resolve("./a.js"), sizedStructs.withLock { $0[handle] } ?? [])
    }
    #expect(result == .external)
    let size = bytes.withUnsafeBytes { $0.loadUnaligned(as: UInt.self) }
    #expect(size == UInt(MemoryLayout<CParcelABI.ResolveResult>.size))
  }

  @Test func resolveTreatsAnUnknownResolutionAsUnresolved() {
    let result = withAssetHandle { asset, handle in
      resolutionTypes.withLock { $0[handle] = 200 }
      return asset.resolve("./a.js")
    }
    #expect(result == nil)
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
    let full = MemoryLayout<CParcelABI.Diagnostic>.size
    let line = MemoryLayout<CParcelABI.Diagnostic>.offset(of: \.line)!
    // Twice the size, as a newer Parcel with more fields might pass.
    var bytes = [UInt8](repeating: 0xab, count: full * 2)

    func read(size: Int, minSize: Int) -> CParcelABI.Diagnostic? {
      bytes.withUnsafeMutableBytes { buffer in
        buffer.storeBytes(of: UInt(size), as: UInt.self)
        return readSized(
          UnsafeRawPointer(buffer.baseAddress!), as: CParcelABI.Diagnostic.self, minSize: minSize)
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
