// swift-tools-version: 6.2

import PackageDescription

// Each example is a dynamic library Parcel can load directly:
//
//   swift build -c release --product TxtTransformer
//
// produces .build/release/libTxtTransformer.dylib (.so on Linux).
let examples = [
  "TxtTransformer",
  "CustomResolver",
  "CustomNamer",
  "CustomOptimizer",
  "CustomReporter",
  "CustomContentTransformer",
  "AsyncPlugin",
]

let package = Package(
  name: "ParcelPluginExamples",
  platforms: [.macOS(.v15)],
  products: examples.map { .library(name: $0, type: .dynamic, targets: [$0]) },
  dependencies: [.package(path: "..")],
  targets: examples.map {
    .target(name: $0, dependencies: [.product(name: "ParcelPlugin", package: "plugin-swift")])
  }
)
