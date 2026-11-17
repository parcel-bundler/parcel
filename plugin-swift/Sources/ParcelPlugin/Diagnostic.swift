internal import CParcelABI

#if canImport(FoundationEssentials)
  import FoundationEssentials
#else
  import Foundation
#endif

/// A structured error or warning from a plugin.
///
/// Throw one from any plugin method to fail it with a code frame and a hint:
///
/// ```swift
/// throw Diagnostic(
///   "unsupported syntax",
///   codeFrames: [.file(asset.filePath, highlights: [CodeHighlight(startLine: 10, startColumn: 5)])],
///   hints: ["remove the unsupported feature"])
/// ```
///
/// Any other `Error` a plugin throws is reported with its message alone. To warn
/// without failing, pass a diagnostic to ``Options/log(_:)`` instead.
public struct Diagnostic: Error, Hashable, Sendable, CustomStringConvertible {
  public var message: String
  public var severity: Severity
  /// Excerpts of the code the diagnostic is about. A Parcel too old to show more
  /// than one shows just the first, with its first highlight.
  public var codeFrames: [CodeFrame]
  /// Suggestions for fixing the problem. A Parcel too old to show more than one
  /// shows just the first.
  public var hints: [String]
  /// A URL to documentation about the diagnostic.
  public var documentationURL: String?
  /// Diagnostics Parcel reported during this call, such as why a read failed,
  /// which this diagnostic stands for. Thrown from a plugin method, it fails
  /// with exactly those, and none of its other fields are reported. 0 for none.
  var parcelDiagnostics: UInt64 = 0

  public init(
    _ message: String,
    severity: Severity = .error,
    codeFrames: [CodeFrame] = [],
    hints: [String] = [],
    documentationURL: String? = nil
  ) {
    self.message = message
    self.severity = severity
    self.codeFrames = codeFrames
    self.hints = hints
    self.documentationURL = documentationURL
  }

  /// A diagnostic with ``Severity/warning`` severity.
  public static func warning(
    _ message: String, codeFrames: [CodeFrame] = [], hints: [String] = [],
    documentationURL: String? = nil
  ) -> Diagnostic {
    Diagnostic(
      message, severity: .warning, codeFrames: codeFrames, hints: hints,
      documentationURL: documentationURL)
  }

  public var description: String { message }

  /// Stands for the diagnostics Parcel reported in `list`. Its message is the
  /// first one's, for printing, or `fallback` when there are none.
  init(
    parcelDiagnostics list: UInt64,
    fallback: String = "Parcel could not read the asset's content"
  ) {
    guard list != 0 else {
      self.init(fallback)
      return
    }
    self.init(hostString { parcel_diagnostic_get_message($0, list, 0) } ?? "")
    parcelDiagnostics = list
  }

  /// The diagnostic Parcel reports for an error a plugin threw.
  init(_ error: any Error) {
    switch error {
    case let diagnostic as Diagnostic:
      self = diagnostic
    case let error as DecodingError:
      self.init(Self.describe(error))
    case let error as LocalizedError where error.errorDescription != nil:
      self.init(error.errorDescription!)
    default:
      self.init(String(describing: error))
    }
  }

  private static func describe(_ error: DecodingError) -> String {
    func path(_ context: DecodingError.Context) -> String {
      let path = context.codingPath.map { key in
        key.intValue.map { "[\($0)]" } ?? ".\(key.stringValue)"
      }.joined()
      return path.isEmpty ? "" : " at \(path.drop { $0 == "." })"
    }
    switch error {
    case .typeMismatch(_, let context), .valueNotFound(_, let context),
      .dataCorrupted(let context):
      return "Invalid plugin config\(path(context)): \(context.debugDescription)"
    case .keyNotFound(let key, let context):
      return "Invalid plugin config\(path(context)): missing key \"\(key.stringValue)\""
    @unknown default:
      return "Invalid plugin config: \(error)"
    }
  }

  /// Fills a diagnostic, field by field, leaving its `size` alone: either one
  /// Parcel allocated, or one from ``withSized(_:_:)``.
  ///
  /// It is built in a list and `diagnostics` set to it: `list()` when given,
  /// which creates one to log through, or else the out-param's own, which
  /// Parcel fills in. Parcel only borrows what the list's builders are passed,
  /// so nothing is allocated. A Parcel too old to build one gets the struct's
  /// own fields instead, which hold just the first frame, highlight and hint, in
  /// buffers the host frees, except where noted.
  ///
  /// Every field written here is in the first layout. One appended after the
  /// first alpha must only be written when `raw.pointee.size` has room for it,
  /// since an older Parcel allocates less.
  func write(
    to raw: UnsafeMutablePointer<CParcelABI.DiagnosticOptions>,
    list: (() -> UInt64)? = nil
  ) {
    if parcelDiagnostics != 0 {
      raw.pointee.diagnostics = parcelDiagnostics
      return
    }
    let list = list?() ?? raw.pointee.diagnostics
    if buildIn(list) {
      raw.pointee.diagnostics = list
      return
    }

    raw.pointee.message = allocBuffer(reportedMessage)
    raw.pointee.severity = severity.rawValue
    let frame = codeFrames.first
    // A frame of a file on disk is the only kind the struct's own fields describe.
    if let filePath = frame?.filePath, !filePath.isEmpty {
      raw.pointee.file_path = allocBuffer(filePath)
    }
    if let highlight = frame?.highlights.first {
      raw.pointee.line = highlight.startLine
      raw.pointee.column = highlight.startColumn
      raw.pointee.end_line = highlight.endLine
      raw.pointee.end_column = highlight.endColumn
      if let message = highlight.message, !message.isEmpty {
        raw.pointee.highlight_message = allocBuffer(message)
      }
    }
    if let hint = hints.first, !hint.isEmpty {
      raw.pointee.hint = allocBuffer(hint)
    }
    if let documentationURL, !documentationURL.isEmpty {
      raw.pointee.documentation_url = allocBuffer(documentationURL)
    }
  }

  /// The message to report: the host reads an empty one as "no diagnostic",
  /// which would turn a failure into a success.
  private var reportedMessage: String { message.isEmpty ? "unknown error" : message }

  /// Builds this diagnostic in `list`. Returns false, having added nothing, when
  /// there is no list or Parcel cannot build one.
  private func buildIn(_ list: UInt64) -> Bool {
    guard list != 0 else { return false }
    // Parcel copies what it keeps before each call returns, so every string is
    // passed by reference to this diagnostic's own.
    let pushed = withBorrowed([reportedMessage, documentationURL]) { strings in
      withSized(DiagnosticEntryOptions.self) { entry in
        entry.pointee.severity = severity.rawValue
        (entry.pointee.message, entry.pointee.message_len) = strings[0]
        (entry.pointee.documentation_url, entry.pointee.documentation_url_len) = strings[1]
        return parcel_diagnostics_push(list, entry)
      }
    }
    guard pushed else { return false }

    for frame in codeFrames {
      withBorrowed([frame.filePath, frame.url, frame.code, frame.language]) { strings in
        withSized(CodeFrameOptions.self) { options in
          (options.pointee.file_path, options.pointee.file_path_len) = strings[0]
          (options.pointee.url, options.pointee.url_len) = strings[1]
          (options.pointee.code, options.pointee.code_len) = strings[2]
          (options.pointee.language, options.pointee.language_len) = strings[3]
          _ = parcel_diagnostics_add_code_frame(list, options)
        }
      }
      for highlight in frame.highlights {
        withBorrowed([highlight.message]) { strings in
          withSized(CodeHighlightOptions.self) { options in
            options.pointee.start_line = highlight.startLine
            options.pointee.start_column = highlight.startColumn
            options.pointee.end_line = highlight.endLine
            options.pointee.end_column = highlight.endColumn
            (options.pointee.message, options.pointee.message_len) = strings[0]
            _ = parcel_diagnostics_add_code_highlight(list, options)
          }
        }
      }
    }
    for hint in hints where !hint.isEmpty {
      _ = withBytes(hint) { parcel_diagnostics_add_hint(list, $0, $1) }
    }
    return true
  }
}

/// Calls `body` with the UTF-8 bytes of each of `strings`, as the pointer and
/// length Parcel borrows them as: nil and 0 for nil or an empty string. The
/// pointers are valid only until `body` returns.
private func withBorrowed<R>(
  _ strings: [String?], _ body: ([(UnsafePointer<UInt8>?, UInt)]) -> R
) -> R {
  var parts: [(UnsafePointer<UInt8>?, UInt)] = []
  parts.reserveCapacity(strings.count)
  func borrow(from index: Int) -> R {
    guard index < strings.count else { return body(parts) }
    guard let string = strings[index], !string.isEmpty else {
      parts.append((nil, 0))
      return borrow(from: index + 1)
    }
    return withBytes(string) { pointer, count in
      parts.append((pointer, count))
      return borrow(from: index + 1)
    }
  }
  return borrow(from: 0)
}

/// Writes `error` to an entry point's diagnostic out-param.
func reportError(_ error: any Error, to raw: UnsafeMutableRawPointer?) {
  guard let raw else { return }
  Diagnostic(error).write(to: raw.assumingMemoryBound(to: CParcelABI.DiagnosticOptions.self))
}
