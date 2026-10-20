// A transformer and resolver in one library, showing async code in a plugin:
// awaiting an actor, running work in parallel off Parcel's thread, and resolving
// a dependency from inside a transform — which calls back into this library's
// own resolver.
//
// Transforms `*.greeting` files into a module that shouts their text, followed
// by the default export of `greeting:suffix`.
//
//   swift build -c release --product AsyncPlugin

import ParcelPlugin

/// State shared by every call, which Parcel makes from many threads at once.
actor TransformCounter {
  private var count = 0

  func next() -> Int {
    count += 1
    return count
  }
}

struct AsyncPlugin: Transformer, Resolver {
  let counter = TransformCounter()

  init(config: NoConfig) async {}

  func transform(_ asset: Asset, options: Options) async throws {
    let lines = asset.content.split(separator: "\n").map(String.init)

    // Hops to the actor, then resumes on the thread Parcel called in on.
    let order = await counter.next()

    // CPU-bound work can run in parallel on Swift's pool, as long as it does
    // not touch `asset` — which the compiler enforces, since it isn't Sendable.
    let shouted = await withTaskGroup(of: (Int, String).self) { group in
      for (index, line) in lines.enumerated() {
        group.addTask(executorPreference: globalConcurrentExecutor) {
          (index, await shout(line))
        }
      }
      var shouted = [String](repeating: "", count: lines.count)
      for await (index, line) in group {
        shouted[index] = line
      }
      return shouted.joined(separator: " ")
    }

    // Runs the resolver chain, which starts with this same library.
    guard case .resolved(let suffixPath, _)? = asset.resolve("greeting:suffix") else {
      throw Diagnostic("could not resolve greeting:suffix", filePath: asset.filePath)
    }
    let suffixFile = suffixPath.split(separator: "/").last.map(String.init) ?? suffixPath

    asset.content = """
      import suffix from "greeting:suffix";
      export const transform = \(order);
      export const resolved = "\(suffixFile)";
      export default "\(shouted)" + suffix;

      """
    asset.type = "js"
  }

  func resolve(
    _ dependency: Dependency, specifier: String, pipeline: String?, options: Options
  ) async throws -> ResolveResult? {
    guard specifier.hasPrefix("greeting:") else { return nil }
    let directory = dependency.resolveFrom.split(separator: "/", omittingEmptySubsequences: false)
      .dropLast().joined(separator: "/")
    return .resolved(filePath: "\(directory)/\(specifier.dropFirst("greeting:".count)).js")
  }
}

@concurrent
func shout(_ line: String) async -> String {
  line.uppercased()
}

#parcelPlugin(AsyncPlugin.self)
