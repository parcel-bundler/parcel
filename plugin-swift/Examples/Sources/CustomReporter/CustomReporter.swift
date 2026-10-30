// A reporter that prints what the build is doing.
//
//   swift build -c release --product CustomReporter

import ParcelPlugin
import Synchronization

#if canImport(FoundationEssentials)
  import FoundationEssentials
#else
  import Foundation
#endif

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
    let summary = summarize(diagnostics)
    // Written to a file when the build's environment names one, e.g. for CI.
    if let path = options.env["REPORT_SUMMARY"] {
      guard FileManager.default.createFile(atPath: path, contents: Data(summary.utf8)) else {
        throw Diagnostic("could not write the summary to \(path)")
      }
    } else {
      print("build failed with \(diagnostics.count) diagnostics:\n\(summary)", terminator: "")
    }
  }

  /// Describes each diagnostic, with where it points and what to read about it.
  private func summarize(_ diagnostics: Diagnostics) -> String {
    var summary = ""
    for diagnostic in diagnostics {
      summary += "message: \(diagnostic.message)\n"
      if let url = diagnostic.documentationURL {
        summary += "docs: \(url)\n"
      }
      for frame in diagnostic.codeFrames {
        summary += "frame: \(frame.filePath ?? frame.url ?? "") \(frame.language ?? "")\n"
        for highlight in frame.highlights {
          summary +=
            "highlight: \(highlight.startLine):\(highlight.startColumn)-\(highlight.endLine):\(highlight.endColumn) \(highlight.message ?? "")\n"
        }
      }
    }
    return summary
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
