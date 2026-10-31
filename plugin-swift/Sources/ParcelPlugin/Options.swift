internal import CParcelABI

/// Read-only access to the build options, passed to every plugin method.
///
/// Valid only for the duration of that call.
public struct Options: Sendable {
  let raw: UInt64
  let scope: CallScope

  init(raw: UInt64, scope: CallScope) {
    self.raw = raw
    self.scope = scope
  }

  /// The absolute path of the project root.
  public var projectRoot: String {
    scope.shared("Options") { hostString { parcel_options_get_project_root($0, raw) } ?? "" }
  }

  /// The build's environment variables, e.g. `options.env["NODE_ENV"]`.
  public var env: EnvironmentVariables { EnvironmentVariables(options: self) }

  /// Sends a message to the build's reporters.
  ///
  /// Dropped when the build has no reporters, or when `level` is below the
  /// build's log level.
  public func log(_ message: String, level: LogLevel = .info) {
    guard !message.isEmpty else { return }
    scope.shared("Options") {
      withBytes(message) { parcel_options_log(raw, level.rawValue, $0, $1) }
    }
  }

  /// Sends a diagnostic to the build's reporters without failing the build — how
  /// a plugin raises a warning, as opposed to throwing it, which fails the call.
  ///
  /// The log level follows the diagnostic's ``Diagnostic/severity``.
  public func log(_ diagnostic: Diagnostic) {
    scope.shared("Options") {
      withSized(CParcelABI.DiagnosticOptions.self) { raw in
        diagnostic.write(to: raw)
        // The host copies what it needs rather than taking ownership, unlike a
        // diagnostic returned from an entry point, so these are ours to free.
        defer {
          parcel_free_buffer(&raw.pointee.message)
          parcel_free_buffer(&raw.pointee.file_path)
          parcel_free_buffer(&raw.pointee.hint)
          parcel_free_buffer(&raw.pointee.highlight_message)
          parcel_free_buffer(&raw.pointee.documentation_url)
        }
        parcel_options_log_diagnostic(self.raw, raw)
      }
    }
  }

  /// The file system, tracked for invalidation. See ``FileSystem``.
  public var fileSystem: FileSystem { FileSystem(options: self) }
}

/// The environment variables of a build.
public struct EnvironmentVariables: Sendable {
  let options: Options

  public subscript(key: String) -> String? {
    guard !key.isEmpty else { return nil }
    return options.scope.shared("Options") {
      hostString { buffer in
        withBytes(key) { parcel_options_get_env(buffer, options.raw, $0, $1) }
      }
    }
  }
}

/// Reads files through Parcel.
///
/// Read files through this rather than `FileManager`: Parcel records every path,
/// so a change to a file re-runs the transform that read it, and a file that was
/// missing re-runs it when created. Only available while transforming or
/// resolving.
public struct FileSystem: Sendable {
  let options: Options

  /// The contents of the file at the absolute `path`.
  public func read(_ path: String) throws(FileSystemError) -> [UInt8] {
    var buffer = CParcelABI.Buffer()
    let status = options.scope.shared("Options") {
      withBytes(path) { parcel_fs_read_file(&buffer, options.raw, $0, $1) }
    }
    try check(status, &buffer, path)
    return takeBytes(&buffer) ?? []
  }

  /// The contents of the file at the absolute `path`, decoded as UTF-8.
  public func readString(_ path: String) throws(FileSystemError) -> String {
    String(decoding: try read(path), as: UTF8.self)
  }

  /// What the absolute `path` refers to, or an empty set when it does not exist.
  ///
  /// Tracked like ``read(_:)``: a missing path re-runs the transform when it is
  /// created, an existing one when it is deleted.
  public func kind(of path: String) -> FileKind {
    options.scope.shared("Options") {
      FileKind(rawValue: withBytes(path) { parcel_fs_get_kind(options.raw, $0, $1) })
    }
  }

  /// Whether the absolute `path` exists. Tracked like ``kind(of:)``.
  public func exists(_ path: String) -> Bool {
    !kind(of: path).isEmpty
  }

  /// The absolute `path` with every symlink resolved.
  public func canonicalize(_ path: String) throws(FileSystemError) -> String {
    var buffer = CParcelABI.Buffer()
    let status = options.scope.shared("Options") {
      withBytes(path) { parcel_fs_canonicalize(&buffer, options.raw, $0, $1) }
    }
    try check(status, &buffer, path)
    return takeString(&buffer) ?? ""
  }

  private func check(
    _ status: UInt8, _ buffer: inout CParcelABI.Buffer, _ path: String
  ) throws(FileSystemError) {
    switch status {
    case 0:
      return
    case 1:
      throw .notFound(path: path)
    // PARCEL_IO_ERROR, or a status this SDK predates.
    default:
      throw .failed(path: path, message: takeString(&buffer) ?? "unknown error")
    }
  }
}

/// A failure reading through ``FileSystem``.
///
/// Parcel may add cases, so a `switch` over one needs an `@unknown default`.
@nonexhaustive
public enum FileSystemError: Error, Hashable, Sendable, CustomStringConvertible {
  case notFound(path: String)
  case failed(path: String, message: String)

  public var description: String {
    switch self {
    case .notFound(let path): "\(path): no such file or directory"
    case .failed(let path, let message): "\(path): \(message)"
    }
  }
}
