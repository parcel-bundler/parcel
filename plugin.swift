// swiftc -emit-library -import-objc-header plugin.h -module-name plugin -Xlinker -undefined -Xlinker dynamic_lookup plugin.swift -o libswiftplugin.dylib
import Foundation

class BufferWrapper {
  private var raw: Buffer

  init(cBuffer: Buffer) {
    self.raw = cBuffer
  }

  public var data: UnsafeBufferPointer<UInt8>? {
    guard let ptr = raw.data else { return nil }
    return UnsafeBufferPointer(start: ptr, count: Int(raw.len))
  }

  public var string: String? {
    guard let data = data else { return nil }
    return String(decoding: data, as: UTF8.self)
  }

  deinit {
    parcel_free_buffer(&raw)
  }
}

struct AssetWrapper {
  let raw: UInt64

  public func getBuffer() -> BufferWrapper {
    var cBuffer = Buffer()
    parcel_asset_get_content(&cBuffer, raw)
    return BufferWrapper(cBuffer: cBuffer)
  }

  public func getCode() -> String? {
    let buffer = getBuffer()
    return buffer.string
  }

  public func setCode(_ content: String) {
    content.withCString { resPtr in
      let dataPtr = UnsafeRawPointer(resPtr).assumingMemoryBound(to: UInt8.self)
      parcel_asset_set_content(raw, dataPtr, UInt32(content.utf8.count))
    }
  }

  public var type: String = "" {
    didSet {
      parcel_asset_set_type(raw, type)
    }
  }
}

@_cdecl("parcel_plugin_transform")
public func parcelPluginTransform(rawAsset: Asset) {
  var asset = AssetWrapper(raw: rawAsset)
  
  if let code = asset.getCode() {
    let res = "export default '" + code.uppercased() + "';"
    asset.setCode(res)
    asset.type = "js"
  }
}
