// Stores parsed data on an asset, and defers generating code until Parcel
// packages it.
//
//   swift build -c release --product CustomContentTransformer

import ParcelPlugin

/// A small stand-in for an AST. Parcel keeps it as the asset's content until
/// packaging.
struct UppercaseContent: AssetContent {
  /// Identifies this type of content to Parcel. Keep it the same across builds:
  /// changing it changes the ids of the bundles it ends up in.
  static let contentTypeID = ContentTypeID("UppercaseContent")

  var source: String
  var words: [String]

  /// The content as source, for anything that needs it before packaging.
  func read() async throws -> Content {
    if source == "PANIC_READ" {
      throw Diagnostic("example custom content read error")
    }
    return .string(source)
  }

  /// Generates the final module, with read-only access to the whole graph.
  func package(_ bundle: OutputBundle, in bundleGraph: BundleGraph, options: Options) async throws
    -> Content
  {
    if source == "PANIC_PACKAGE" {
      throw Diagnostic("example custom content package error")
    }

    var foundSelf = false
    var dependencyCount = 0
    for asset in bundleGraph.assets {
      for index in 0..<asset.dependencyCount {
        dependencyCount += 1
        _ = bundleGraph.resolution(ofDependency: index, of: asset.index)
      }
      if let content = asset.customContent(as: UppercaseContent.self), content.source == source {
        foundSelf = true
      }
    }
    guard foundSelf else {
      throw Diagnostic("custom content was not accessible through the bundle graph")
    }

    let value = words.joined(separator: " ").uppercased()
    return .string(
      """
      // custom-content assets=\(bundleGraph.assetCount) bundles=\(bundleGraph.bundleCount) dependencies=\(dependencyCount) type=\(bundle.type)
      export default "\(value)";

      """)
  }
}

struct CustomContentTransformer: Transformer {
  init(config: NoConfig) {}

  func transform(_ asset: Asset, options: Options) async throws {
    let source = try asset.content().trimmingWhitespace()
    // Swift cannot recover from a trap, so unlike the Go example these throw.
    if source == "PANIC_TRANSFORM" {
      throw Diagnostic("example transform error")
    }
    asset.setCustomContent(
      UppercaseContent(source: source, words: source.split(separator: " ").map(String.init)))
    if source == "PANIC_READ" {
      // Reading the content back runs the read callback. When it fails, the
      // error carries Parcel's diagnostic for it, which rethrowing reports
      // unchanged.
      _ = try asset.content()
    }
  }
}

extension String {
  fileprivate func trimmingWhitespace() -> String {
    String(drop(while: \.isWhitespace).reversed().drop(while: \.isWhitespace).reversed())
  }
}

#parcelPlugin(CustomContentTransformer.self)
