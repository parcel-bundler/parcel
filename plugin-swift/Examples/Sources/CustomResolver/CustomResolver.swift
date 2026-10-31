// A resolver that maps `custom:name` specifiers to `name.js` next to the file
// that imports them: `import x from "custom:foo"` resolves to `./foo.js`.
//
//   swift build -c release --product CustomResolver

import ParcelPlugin

struct CustomResolver: Resolver {
  init(config: NoConfig) {}

  func resolve(
    _ dependency: Dependency, specifier: String, pipeline: String?, options: Options
  ) async throws -> ResolveResult {
    guard specifier.hasPrefix("custom:") else {
      return .unresolved  // Not ours: on to the next resolver.
    }
    let name = specifier.dropFirst("custom:".count)
    let directory = dependency.resolveFrom.split(separator: "/", omittingEmptySubsequences: false)
      .dropLast().joined(separator: "/")
    let path = "\(directory)/\(name).js"

    // Checked through Parcel, so creating the file later re-runs the resolve.
    guard options.fileSystem.exists(path) else {
      throw Diagnostic(
        "Cannot resolve \(specifier): \(path) does not exist", filePath: dependency.sourcePath,
        hint: "Create \(name).js next to the file that imports it.")
    }
    return .file(path)
  }
}

#parcelPlugin(CustomResolver.self)
