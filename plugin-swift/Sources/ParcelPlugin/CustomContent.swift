internal import CParcelABI
import Synchronization

#if canImport(Darwin)
  import Darwin
#elseif canImport(Glibc)
  import Glibc
#elseif canImport(Musl)
  import Musl
#endif

/// Plugin-owned data stored on an asset in place of its content, e.g. a parsed
/// AST, which Parcel keeps until it packages the asset.
///
/// Parcel calls ``read()`` when something needs the asset's content before then,
/// and ``package(_:in:options:)`` to produce the packaged output. Both may be
/// called long after the transform that set the content returned, from any
/// thread, and concurrently — hence `Sendable`.
public protocol AssetContent: Sendable {
  /// A stable id for this type of content. Defaults to one derived from the
  /// type's fully qualified name.
  static var contentTypeID: ContentTypeID { get }

  /// The content as source, for anything that needs it before packaging.
  func read() async throws -> Content

  /// The packaged output for the asset in `bundle`.
  func package(_ bundle: OutputBundle, in bundleGraph: BundleGraph, options: Options) async throws
    -> Content
}

extension AssetContent {
  public static var contentTypeID: ContentTypeID {
    ContentTypeID.cached(for: Self.self)
  }
}

/// A stable 16-byte id for a type of ``AssetContent``.
///
/// Parcel compares ids rather than types, and they are part of its cache, so an
/// id must not change between builds of the plugin.
public struct ContentTypeID: Hashable, Sendable {
  let high: UInt64
  let low: UInt64

  /// The id for `name`, which must be unique among the plugin's content types.
  public init(_ name: String) {
    let digest = SHA256.hash(Array("parcel.content.v1\0swift\0\(name)".utf8))
    high = digest[0..<8].reduce(0) { $0 << 8 | UInt64($1) }
    low = digest[8..<16].reduce(0) { $0 << 8 | UInt64($1) }
  }

  init(bytes: [UInt8]) {
    high = bytes[0..<8].reduce(0) { $0 << 8 | UInt64($1) }
    low = bytes[8..<16].reduce(0) { $0 << 8 | UInt64($1) }
  }

  /// The id's bytes.
  public var bytes: [UInt8] {
    (0..<8).map { UInt8(truncatingIfNeeded: high >> UInt64(56 - $0 * 8)) }
      + (0..<8).map { UInt8(truncatingIfNeeded: low >> UInt64(56 - $0 * 8)) }
  }

  private static let cache = Mutex<[ObjectIdentifier: ContentTypeID]>([:])

  static func cached(for type: Any.Type) -> ContentTypeID {
    if let id = cache.withLock({ $0[ObjectIdentifier(type)] }) {
      return id
    }
    let id = ContentTypeID(String(reflecting: type))
    cache.withLock { $0[ObjectIdentifier(type)] = id }
    return id
  }
}

/// Owns a plugin's ``AssetContent`` while Parcel holds it.
///
/// Parcel's `void *content` points at a two-word header allocated with `malloc`:
/// a witness identifying this copy of the SDK, then the retained box. Before
/// reading anything through a pointer the host hands back, the type id must be
/// one this copy produced — which implies the header layout — and then the
/// witness must be this copy's. Another copy of the same plugin (a different
/// version loaded as a separate library, possibly with its own Swift runtime)
/// produces the same type ids, and is rejected by the witness.
final class CustomContentBox: @unchecked Sendable {
  let content: any AssetContent

  private init(_ content: any AssetContent) {
    self.content = content
  }

  /// Unique to this copy of the SDK in the process: the address of a class's
  /// metadata.
  private static var witness: UInt {
    unsafeBitCast(CustomContentBox.self as AnyClass, to: UInt.self)
  }

  /// Every type id this copy has attached, so a foreign pointer is only read
  /// once its id proves it has our header.
  private static let attachedTypeIDs = Mutex<Set<ContentTypeID>>([])

  static func attach(_ content: some AssetContent, to asset: UInt64) {
    let typeID = type(of: content).contentTypeID
    attachedTypeIDs.withLock { _ = $0.insert(typeID) }

    let header = malloc(2 * MemoryLayout<UInt>.stride)!.assumingMemoryBound(to: UInt.self)
    header[0] = witness
    header[1] = UInt(bitPattern: Unmanaged.passRetained(CustomContentBox(content)).toOpaque())

    var id = typeIDTuple(typeID)
    parcel_asset_set_custom_content(
      asset, &id, UnsafeMutableRawPointer(header), readContent, packageContent, freeContent)
  }

  static func content(of asset: UInt64) -> (any AssetContent)? {
    var id = typeIDTuple(ContentTypeID(bytes: Array(repeating: 0, count: 16)))
    var pointer: UnsafeMutableRawPointer?
    guard parcel_asset_get_custom_content(&id, &pointer, asset), let pointer else {
      return nil
    }
    let typeID = withUnsafeBytes(of: id) { ContentTypeID(bytes: Array($0)) }
    guard attachedTypeIDs.withLock({ $0.contains(typeID) }) else { return nil }
    return box(UnsafeRawPointer(pointer))?.content
  }

  fileprivate static func box(_ pointer: UnsafeRawPointer?) -> CustomContentBox? {
    guard let header = pointer?.assumingMemoryBound(to: UInt.self), header[0] == witness,
      let object = UnsafeRawPointer(bitPattern: header[1])
    else {
      return nil
    }
    return Unmanaged<CustomContentBox>.fromOpaque(object).takeUnretainedValue()
  }

  private static func typeIDTuple(_ id: ContentTypeID) -> (
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8
  ) {
    let b = id.bytes
    return (
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
      b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
  }
}

// ── Callbacks ───────────────────────────────────────────────────────────────

private func readContent(
  _ pointer: UnsafeRawPointer?, _ buffer: UnsafeMutablePointer<CParcelABI.Buffer>?,
  _ diagnostic: UnsafeMutablePointer<CParcelABI.Diagnostic>?
) {
  guard let box = CustomContentBox.box(pointer) else {
    reportError(Diagnostic("custom content is no longer valid"), to: diagnostic)
    return
  }
  let content = box.content
  switch runOnHostThread({ try await content.read() }) {
  case .success(let result):
    write(result, to: buffer)
  case .failure(let error):
    reportError(error, to: diagnostic)
  }
}

private func packageContent(
  _ pointer: UnsafeRawPointer?, _ graph: UInt64, _ bundle: UInt64, _ options: UInt64,
  _ buffer: UnsafeMutablePointer<CParcelABI.Buffer>?,
  _ diagnostic: UnsafeMutablePointer<CParcelABI.Diagnostic>?
) {
  guard let box = CustomContentBox.box(pointer) else {
    reportError(Diagnostic("custom content is no longer valid"), to: diagnostic)
    return
  }
  let content = box.content
  let scope = CallScope("package")
  defer { scope.close() }
  let result = runOnHostThread {
    let options = Options(raw: options, scope: scope)
    return try await content.package(
      OutputBundle(raw: bundle, options: options),
      in: BundleGraph(raw: graph, options: options), options: options)
  }
  switch result {
  case .success(let result):
    write(result, to: buffer)
  case .failure(let error):
    reportError(error, to: diagnostic)
  }
}

private func freeContent(_ pointer: UnsafeMutableRawPointer?) {
  guard let pointer else { return }
  let header = pointer.assumingMemoryBound(to: UInt.self)
  if let object = UnsafeRawPointer(bitPattern: header[1]) {
    Unmanaged<CustomContentBox>.fromOpaque(object).release()
  }
  free(pointer)
}

/// Writes plugin content to a host buffer.
func write(_ content: Content, to buffer: UnsafeMutablePointer<CParcelABI.Buffer>?) {
  guard let buffer else { return }
  switch content {
  case .string(let string):
    withBytes(string) { parcel_buffer_write_utf8(buffer, $0, $1) }
  case .bytes(let bytes):
    withBytes(bytes) { parcel_buffer_write(buffer, $0, $1) }
  }
}

func reportError(_ error: any Error, to diagnostic: UnsafeMutablePointer<CParcelABI.Diagnostic>?) {
  reportError(error, to: UnsafeMutableRawPointer(diagnostic))
}
