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
/// throw Diagnostic("unsupported syntax", filePath: asset.filePath, line: 10, column: 5,
///                  hint: "remove the unsupported feature")
/// ```
///
/// Any other `Error` a plugin throws is reported with its message alone. To warn
/// without failing, pass a diagnostic to ``Options/log(_:)`` instead.
public struct Diagnostic: Error, Hashable, Sendable, CustomStringConvertible {
  public var message: String
  public var severity: Severity
  /// Absolute path of the file to show a code frame for.
  public var filePath: String?
  /// 1-based line of the code frame's highlight, or 0 for none.
  public var line: UInt32
  /// 1-based column of the code frame's highlight, or 0 for none.
  public var column: UInt32
  /// 1-based line of the highlight's last character, or 0 to highlight just the
  /// one at ``line`` and ``column``.
  public var endLine: UInt32
  /// 1-based column of the highlight's last character.
  public var endColumn: UInt32
  /// A message shown at the highlight.
  public var highlightMessage: String?
  public var hint: String?
  /// A URL to documentation about the diagnostic.
  public var documentationURL: String?
  /// Diagnostics Parcel reported during this call, such as why a read failed,
  /// which this diagnostic stands for. Thrown from a plugin method, it fails
  /// with exactly those, and none of its other fields are reported. 0 for none.
  var parcelDiagnostics: UInt64 = 0

  public init(
    _ message: String,
    severity: Severity = .error,
    filePath: String? = nil,
    line: UInt32 = 0,
    column: UInt32 = 0,
    endLine: UInt32 = 0,
    endColumn: UInt32 = 0,
    highlightMessage: String? = nil,
    hint: String? = nil,
    documentationURL: String? = nil
  ) {
    self.message = message
    self.severity = severity
    self.filePath = filePath
    self.line = line
    self.column = column
    self.endLine = endLine
    self.endColumn = endColumn
    self.highlightMessage = highlightMessage
    self.hint = hint
    self.documentationURL = documentationURL
  }

  /// A diagnostic with ``Severity/warning`` severity.
  public static func warning(
    _ message: String, filePath: String? = nil, line: UInt32 = 0, column: UInt32 = 0,
    endLine: UInt32 = 0, endColumn: UInt32 = 0, highlightMessage: String? = nil,
    hint: String? = nil, documentationURL: String? = nil
  ) -> Diagnostic {
    Diagnostic(
      message, severity: .warning, filePath: filePath, line: line, column: column,
      endLine: endLine, endColumn: endColumn, highlightMessage: highlightMessage, hint: hint,
      documentationURL: documentationURL)
  }

  public var description: String { message }

  /// Stands for the diagnostics Parcel reported in `list`. Its message is the
  /// first one's, for printing.
  init(parcelDiagnostics list: UInt64) {
    guard list != 0 else {
      self.init("Parcel could not read the asset's content")
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
  /// Parcel allocated, or one from ``withSized(_:_:)``. The host frees its
  /// buffers, except where noted.
  ///
  /// Every field here is in the first layout. One appended after the first alpha
  /// must only be written when `raw.pointee.size` has room for it, since an older
  /// Parcel allocates less.
  func write(to raw: UnsafeMutablePointer<CParcelABI.DiagnosticOptions>) {
    if parcelDiagnostics != 0 {
      raw.pointee.diagnostics = parcelDiagnostics
      return
    }
    // The host reads a null message as "no diagnostic", which would turn a
    // failure into a success.
    raw.pointee.message = allocBuffer(message.isEmpty ? "unknown error" : message)
    raw.pointee.severity = severity.rawValue
    if let filePath, !filePath.isEmpty {
      raw.pointee.file_path = allocBuffer(filePath)
    }
    raw.pointee.line = line
    raw.pointee.column = column
    if let hint, !hint.isEmpty {
      raw.pointee.hint = allocBuffer(hint)
    }

    raw.pointee.end_line = endLine
    raw.pointee.end_column = endColumn
    if let highlightMessage, !highlightMessage.isEmpty {
      raw.pointee.highlight_message = allocBuffer(highlightMessage)
    }
    if let documentationURL, !documentationURL.isEmpty {
      raw.pointee.documentation_url = allocBuffer(documentationURL)
    }
  }
}

/// Writes `error` to an entry point's diagnostic out-param.
func reportError(_ error: any Error, to raw: UnsafeMutableRawPointer?) {
  guard let raw else { return }
  Diagnostic(error).write(to: raw.assumingMemoryBound(to: CParcelABI.DiagnosticOptions.self))
}
