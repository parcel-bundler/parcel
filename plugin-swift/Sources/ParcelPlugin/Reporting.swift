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
}
