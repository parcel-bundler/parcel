// A reporter that prints what the build is doing.
//
//   swift build -c release --product CustomReporter

import ParcelPlugin
import Synchronization

final class CustomReporter: Reporter {
  // Parcel calls a plugin from many threads at once; shared state needs a lock
  // or an actor.
  private let builds = Atomic<Int>(0)

  init(config: NoConfig) {}

  func buildStarted(options: Options) async throws {
    let build = builds.add(1, ordering: .relaxed).newValue
    print("build \(build) starting")
  }

  func buildSucceeded(_ build: BuildSuccess, options: Options) async throws {
    print(
      "built \(build.bundleGraph.bundleCount) bundles in \(build.buildTime) (\(build.changedAssets.count) assets changed)"
    )
  }

  func buildFailed(_ diagnostics: Diagnostics, options: Options) async throws {
    print("build failed with \(diagnostics.count) diagnostics:")
    for diagnostic in diagnostics {
      print(diagnostic.message, diagnostic.origin.map { "(\($0))" } ?? "", diagnostic.hints)
    }
  }

  func log(_ entry: LogEntry, options: Options) async throws {
    switch entry.message {
    case .text(let message):
      print("[\(entry.level)] \(message)")
    case .diagnostics(let diagnostics):
      for diagnostic in diagnostics {
        print("[\(entry.level)] \(diagnostic.message)")
      }
    }
  }
}

#parcelPlugin(CustomReporter.self)
