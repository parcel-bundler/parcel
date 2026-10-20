internal import CParcelABI
import Synchronization

#if canImport(FoundationEssentials)
  import FoundationEssentials
#else
  import Foundation
#endif

/// The `ParcelApi` table this library was initialized with, as an address.
///
/// Parcel calls `parcel_plugin_init` once per `.parcelrc` entry naming this
/// library, possibly concurrently, and always with the same table. A different
/// table means two Parcel instances are sharing this library, which cannot work:
/// whichever lost would be calling the other's functions.
private let installedAPI = Atomic<UInt>(0)

/// Checks and stores the table Parcel passed to `parcel_plugin_init`.
///
/// Returns `false` when the table cannot be used, in which case no host function
/// may be called — not even to write a diagnostic, since allocating one goes
/// through the very table being rejected.
func installAPI(_ api: UnsafeRawPointer?) -> Bool {
  guard let api, parcel_api_compatible(api.assumingMemoryBound(to: ParcelApiHeader.self)) else {
    return false
  }
  let address = UInt(bitPattern: api)
  let (exchanged, original) = installedAPI.compareExchange(
    expected: 0, desired: address, ordering: .acquiringAndReleasing)
  guard exchanged || original == address else {
    return false
  }
  // Every caller that gets here stores the same value, so a concurrent init
  // racing on this store is benign. Assigning before returning means no caller
  // can reach a host function before the table is in place.
  parcel_swift_set_api(api.assumingMemoryBound(to: ParcelApi.self))
  return true
}

// ── Buffers ─────────────────────────────────────────────────────────────────

/// Calls `fill` with an empty host buffer, and copies out and frees whatever the
/// host wrote. `nil` when the host wrote nothing.
func hostBytes(_ fill: (UnsafeMutablePointer<CParcelABI.Buffer>) -> Void) -> [UInt8]? {
  var buffer = CParcelABI.Buffer()
  fill(&buffer)
  return takeBytes(&buffer)
}

/// Like ``hostBytes(_:)``, decoded as UTF-8.
func hostString(_ fill: (UnsafeMutablePointer<CParcelABI.Buffer>) -> Void) -> String? {
  var buffer = CParcelABI.Buffer()
  fill(&buffer)
  return takeString(&buffer)
}

/// Copies a host-filled buffer into a Swift array and frees it.
func takeBytes(_ buffer: inout CParcelABI.Buffer) -> [UInt8]? {
  guard let data = buffer.data else { return nil }
  defer { parcel_free_buffer(&buffer) }
  return Array(UnsafeBufferPointer(start: data, count: Int(buffer.len)))
}

/// Copies a host-filled buffer into a Swift string and frees it.
func takeString(_ buffer: inout CParcelABI.Buffer) -> String? {
  guard let data = buffer.data else { return nil }
  defer { parcel_free_buffer(&buffer) }
  return String(decoding: UnsafeBufferPointer(start: data, count: Int(buffer.len)), as: UTF8.self)
}

/// Allocates a host buffer holding `string`, for out-params the host frees.
func allocBuffer(_ string: String) -> CParcelABI.Buffer {
  withBytes(string) { pointer, count in parcel_buffer_alloc(pointer, count) }
}

/// A byte the content setters can point at when there is nothing to write: they
/// ignore a null pointer, and must still be able to empty an asset.
nonisolated(unsafe) private let emptyByte = UnsafeMutablePointer<UInt8>.allocate(capacity: 1)

/// Calls `body` with a pointer to the UTF-8 bytes of `string`, never null.
func withBytes<R>(
  _ string: String, _ body: (UnsafePointer<UInt8>, UInt) throws -> R
) rethrows -> R {
  var string = string
  return try string.withUTF8 { buffer in
    try body(buffer.baseAddress ?? UnsafePointer(emptyByte), UInt(buffer.count))
  }
}

/// Calls `body` with a pointer to `bytes`, never null. Contiguous storage —
/// `[UInt8]`, `Data`, slices of either — is passed through without a copy; only
/// something like `DispatchData` with several regions is flattened first.
func withBytes<R>(
  _ bytes: some DataProtocol, _ body: (UnsafePointer<UInt8>, UInt) throws -> R
) rethrows -> R {
  if let result = try bytes.withContiguousStorageIfAvailable({ buffer in
    try body(buffer.baseAddress ?? UnsafePointer(emptyByte), UInt(buffer.count))
  }) {
    return result
  }
  return try Array(bytes).withUnsafeBufferPointer { buffer in
    try body(buffer.baseAddress ?? UnsafePointer(emptyByte), UInt(buffer.count))
  }
}

/// Calls `body` with the bytes of `string`, or a null pointer when it is nil.
func withOptionalBytes<R>(
  _ string: String?, _ body: (UnsafePointer<UInt8>?, UInt) throws -> R
) rethrows -> R {
  guard let string else { return try body(nil, 0) }
  return try withBytes(string) { try body($0, $1) }
}

/// Decodes a pointer and length the host passed in. Empty for a null pointer.
func decodeString(_ pointer: UnsafePointer<UInt8>?, _ count: Int) -> String {
  guard let pointer, count > 0 else { return "" }
  return String(decoding: UnsafeBufferPointer(start: pointer, count: count), as: UTF8.self)
}
