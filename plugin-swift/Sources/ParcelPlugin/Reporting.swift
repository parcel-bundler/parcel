internal import CParcelABI

/// A build that finished and wrote its output.
public struct BuildSuccess: Sendable {
  public let bundleGraph: BundleGraph
  /// How long the build took.
  public let buildTime: Duration
  /// The assets re-transformed by this build. Empty after a full build, which
  /// transformed all of them.
  public let changedAssets: [AssetIndex]
}

/// A message from Parcel or another plugin.
public struct LogEntry: Sendable {
  public enum Message: Sendable {
    case text(String)
    case diagnostics(Diagnostics)
  }

  public let level: LogLevel
  public let message: Message
}

/// The diagnostics carried by a failed build or a log entry.
///
/// Valid only for the duration of the reporter call it was passed to.
public struct Diagnostics: RandomAccessCollection, Sendable {
  let raw: UInt64
  let scope: CallScope

  public var startIndex: Int { 0 }
  public var endIndex: Int {
    raw == 0 ? 0 : scope.shared("Diagnostics") { Int(parcel_diagnostics_get_count(raw)) }
  }

  public subscript(position: Int) -> DiagnosticInfo {
    precondition(indices.contains(position), "diagnostic index out of range")
    return DiagnosticInfo(diagnostics: self, index: UInt(position))
  }
}

/// One diagnostic within ``Diagnostics``.
public struct DiagnosticInfo: Sendable {
  let diagnostics: Diagnostics
  let index: UInt

  @inline(__always)
  private func host<R>(_ body: (UInt64) -> R) -> R {
    diagnostics.scope.shared("Diagnostics") { body(diagnostics.raw) }
  }

  public var message: String {
    host { raw in hostString { parcel_diagnostic_get_message($0, raw, index) } ?? "" }
  }

  public var severity: Severity {
    host { Severity(rawValue: parcel_diagnostic_get_severity($0, index)) }
  }

  /// The name of the plugin the diagnostic came from, if it recorded one.
  public var origin: String? {
    host { raw in hostString { parcel_diagnostic_get_origin($0, raw, index) } }
  }

  public var hints: [String] {
    host { raw in
      (0..<parcel_diagnostic_get_hint_count(raw, index)).map { hint in
        hostString { parcel_diagnostic_get_hint($0, raw, index, hint) } ?? ""
      }
    }
  }

  /// A URL to documentation about the diagnostic, if it has one.
  public var documentationURL: String? {
    host { raw in hostString { parcel_diagnostic_get_documentation_url($0, raw, index) } }
  }

  /// Excerpts of the files the diagnostic is about, with parts of them
  /// highlighted. Empty when it has none.
  public var codeFrames: [CodeFrame] {
    host { raw in
      (0..<parcel_diagnostic_get_code_frame_count(raw, index)).compactMap { frame in
        withSized(CodeFrameInfo.self) { info -> CodeFrame? in
          guard parcel_diagnostic_get_code_frame(info, raw, index, frame) else { return nil }
          let highlights = (0..<info.pointee.highlight_count).compactMap { highlight in
            withSized(CodeHighlightInfo.self) { info -> CodeHighlight? in
              guard parcel_diagnostic_get_code_highlight(info, raw, index, frame, highlight)
              else { return nil }
              return CodeHighlight(
                startLine: info.pointee.start_line, startColumn: info.pointee.start_column,
                endLine: info.pointee.end_line, endColumn: info.pointee.end_column,
                message: takeString(&info.pointee.message))
            }
          }
          return CodeFrame(
            filePath: takeString(&info.pointee.file_path), url: takeString(&info.pointee.url),
            code: takeString(&info.pointee.code), language: takeString(&info.pointee.language),
            highlights: highlights)
        }
      }
    }
  }
}

/// An excerpt of a file a diagnostic is about, with parts of it highlighted.
public struct CodeFrame: Hashable, Sendable {
  /// The absolute path of the file, when it is one on disk.
  public var filePath: String?
  /// The URL of the file, e.g. a `file:` URL, when the frame names one.
  public var url: String?
  /// The code to show, when it differs from the file's contents.
  public var code: String?
  /// The code's language, as a file extension, when known.
  public var language: String?
  public var highlights: [CodeHighlight]
}

/// A highlighted range in a ``CodeFrame``. Lines and columns are 1-based, and
/// the end is the last highlighted character.
public struct CodeHighlight: Hashable, Sendable {
  public var startLine: UInt32
  public var startColumn: UInt32
  public var endLine: UInt32
  public var endColumn: UInt32
  /// A message shown at the highlight.
  public var message: String?
}
