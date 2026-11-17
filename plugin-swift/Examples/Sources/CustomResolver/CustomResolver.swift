// A resolver that maps `custom:name` specifiers to `name.js` next to the file
// that imports them: `import x from "custom:foo"` resolves to `./foo.js`.
//
// `custom-deprecated:name` resolves the same way, with a warning. Both show
// diagnostics with more than one code frame: the warning points at the import
// and at what it resolved to, and a missing module's error at the import and at
// what to create.
//
//   swift build -c release --product CustomResolver

import ParcelPlugin

struct CustomResolver: Resolver {
  init(config: NoConfig, context: InitContext) {}

  func resolve(
    _ dependency: Dependency, specifier: String, pipeline: String?, options: Options
  ) async throws -> ResolveResult {
    let name: Substring
    let deprecated: Bool
    if specifier.hasPrefix("custom:") {
      (name, deprecated) = (specifier.dropFirst("custom:".count), false)
    } else if specifier.hasPrefix("custom-deprecated:") {
      (name, deprecated) = (specifier.dropFirst("custom-deprecated:".count), true)
    } else {
      return .unresolved  // Not ours: on to the next resolver.
    }
    let importer = dependency.resolveFrom
    let directory = importer.split(separator: "/", omittingEmptySubsequences: false)
      .dropLast().joined(separator: "/")
    let path = "\(directory)/\(name).js"

    // Where the import is, assuming it is on the first line, as in the fixtures.
    let imported = CodeFrame.file(
      importer,
      highlights: [
        CodeHighlight(
          startLine: 1, startColumn: 1, endLine: 1, endColumn: 1,
          message: "`\(specifier)` imported here")
      ])

    // Checked through Parcel, so creating the file later re-runs the resolve.
    guard options.fileSystem.exists(path) else {
      throw Diagnostic(
        "Could not find custom module `\(name)`",
        codeFrames: [
          imported,
          .code(
            "export default \"\(name)\";\n", url: "custom:\(name)", language: "js",
            highlights: [
              CodeHighlight(
                startLine: 1, startColumn: 1, endLine: 1, endColumn: 6,
                message: "create it like this")
            ]),
        ],
        hints: ["Create \(path)", "Or import a module that exists"])
    }

    if deprecated {
      options.log(
        .warning(
          "`custom-deprecated:` is deprecated",
          codeFrames: [
            imported,
            .file(
              path,
              highlights: [CodeHighlight(startLine: 1, startColumn: 1, message: "resolved to this")]
            ),
          ],
          hints: ["Import `custom:\(name)` instead"]))
    }
    return .file(path)
  }
}

#parcelPlugin(CustomResolver.self)
