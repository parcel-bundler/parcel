// A transformer that turns plain text files into ES modules default-exporting
// their content as a string.
//
//   swift build -c release --product TxtTransformer

import ParcelPlugin

struct TxtTransformer: Transformer {
  struct Config: Decodable {
    /// Prepended to every file's text.
    var prefix: String?
  }

  let prefix: String

  init(config: Config) {
    prefix = config.prefix ?? ""
  }

  func transform(_ asset: Asset, options: Options) async throws {
    asset.setContent("export default \(javaScriptString(prefix + (try asset.content())));\n")
    asset.type = "js"
  }
}

/// `string` as a JavaScript string literal.
func javaScriptString(_ string: String) -> String {
  var literal = "\""
  for scalar in string.unicodeScalars {
    switch scalar {
    case "\"": literal += "\\\""
    case "\\": literal += "\\\\"
    case "\n": literal += "\\n"
    case "\r": literal += "\\r"
    case "\t": literal += "\\t"
    case "\u{2028}", "\u{2029}": literal += "\\u\(String(scalar.value, radix: 16))"
    case _ where scalar.value < 0x20:
      literal += "\\u00\(scalar.value < 0x10 ? "0" : "")\(String(scalar.value, radix: 16))"
    default: literal.unicodeScalars.append(scalar)
    }
  }
  return literal + "\""
}

#parcelPlugin(TxtTransformer.self)
