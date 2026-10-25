// A transformer that prepends a line to each asset, such as a license comment
// or a polyfill import, and keeps the source map an earlier transformer
// attached, so the bundle still maps back to the original files.
//
//   swift build -c release --product PrependTransformer

import Foundation
import ParcelPlugin

struct PrependTransformer: Transformer {
  struct Config: Decodable {
    /// The line to prepend.
    var line: String?
  }

  let line: String

  init(config: Config) {
    line = config.line ?? "/* Built with Parcel */"
  }

  func transform(_ asset: Asset, options: Options) async throws {
    let content = line + "\n" + asset.content

    // Without a map, Parcel maps the asset as if this content were its source.
    guard let sourceMap = asset.sourceMap,
      var map = try JSONSerialization.jsonObject(with: Data(sourceMap.utf8)) as? [String: Any]
    else {
      asset.content = content
      return
    }

    // Everything moved down a line. In VLQ mappings each `;` starts the next
    // generated line, so an empty one in front shifts the rest.
    if let mappings = map["mappings"] as? String {
      map["mappings"] = ";" + mappings
    }
    let shifted = try JSONSerialization.data(withJSONObject: map)
    asset.setContent(content, sourceMap: String(decoding: shifted, as: UTF8.self))
  }
}

#parcelPlugin(PrependTransformer.self)
