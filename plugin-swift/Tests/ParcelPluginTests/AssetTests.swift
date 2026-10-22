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
  return api
}()

private let nextHandle = Atomic<UInt64>(1)

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
