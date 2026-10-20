// An optimizer that prepends a comment to bundles, and keeps their source maps.
//
//   swift build -c release --product CustomOptimizer

import ParcelPlugin

struct CustomOptimizer: Optimizer {
  init(config: NoConfig) {}

  func optimize(
    _ bundle: OutputBundle, in bundleGraph: BundleGraph, contents: [UInt8], sourceMap: [UInt8]?,
    options: Options
  ) async throws -> OptimizeResult {
    let header = """
      /* optimized by Swift: assets=\(bundleGraph.assetCount) bundles=\(bundleGraph.bundleCount) \
      type=\(bundle.type) map=\(sourceMap != nil) */

      """
    return OptimizeResult(
      contents: .string(header + String(decoding: contents, as: UTF8.self)),
      sourceMap: sourceMap)
  }
}

#parcelPlugin(CustomOptimizer.self)
