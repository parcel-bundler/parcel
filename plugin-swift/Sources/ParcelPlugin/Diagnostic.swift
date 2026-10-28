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
  public var hint: String?

  public init(
    _ message: String,
    severity: Severity = .error,
    filePath: String? = nil,
    line: UInt32 = 0,
    column: UInt32 = 0,
    hint: String? = nil
  ) {
    self.message = message
    self.severity = severity
    self.filePath = filePath
    self.line = line
    self.column = column
    self.hint = hint
  }

  /// A diagnostic with ``Severity/warning`` severity.
  public static func warning(
    _ message: String, filePath: String? = nil, line: UInt32 = 0, column: UInt32 = 0,
    hint: String? = nil
  ) -> Diagnostic {
    Diagnostic(
      message, severity: .warning, filePath: filePath, line: line, column: column, hint: hint)
  }

  public var description: String { message }

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
  /// Every field here was in ABI 2. One added later must only be written when
  /// `raw.pointee.size` has room for it, since an older Parcel allocates less.
  func write(to raw: UnsafeMutablePointer<CParcelABI.Diagnostic>) {
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
  }
}

/// Writes `error` to an entry point's diagnostic out-param.
func reportError(_ error: any Error, to raw: UnsafeMutableRawPointer?) {
  guard let raw else { return }
  Diagnostic(error).write(to: raw.assumingMemoryBound(to: CParcelABI.Diagnostic.self))
}
