// A namer that prefixes entry bundle names with "swift-", keeping the bundle
// type's extension.
//
//   swift build -c release --product CustomNamer

import ParcelPlugin

struct CustomNamer: Namer {
  init(config: NoConfig) {}

  func name(_ bundle: OutputBundle, in bundleGraph: BundleGraph, options: Options) async throws
    -> String?
  {
    guard let entry = bundle.mainEntryAsset, let asset = bundleGraph.asset(at: entry) else {
      return nil  // On to the next namer.
    }
    let base = asset.filePath.split(separator: "/").last.map(String.init) ?? "bundle"
    let stem = base.split(separator: ".").first.map(String.init) ?? base
    return "swift-\(stem).\(bundle.type)"
  }
}

#parcelPlugin(CustomNamer.self)
