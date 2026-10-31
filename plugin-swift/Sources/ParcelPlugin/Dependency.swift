internal import CParcelABI

/// A dependency to add to an asset, or to resolve, from a transformer.
public struct DependencyOptions: Hashable, Sendable {
  public var specifier: String
  public var specifierType: SpecifierType
  public var priority: Priority
  public var bundleBehavior: BundleBehavior
  public var flags: DependencyFlags
  public var conditions: ExportsConditions
  public var importType: ImportType

  public init(
    _ specifier: String,
    specifierType: SpecifierType = .esm,
    priority: Priority = .sync,
    bundleBehavior: BundleBehavior = .none,
    flags: DependencyFlags = [],
    conditions: ExportsConditions = [],
    importType: ImportType = .javaScript
  ) {
    self.specifier = specifier
    self.specifierType = specifierType
    self.priority = priority
    self.bundleBehavior = bundleBehavior
    self.flags = flags
    self.conditions = conditions
    self.importType = importType
  }

  func withRaw<R>(_ body: (UnsafePointer<CParcelABI.DependencyOptions>) -> R) -> R {
    withBytes(specifier) { pointer, count in
      withSized(CParcelABI.DependencyOptions.self) { raw in
        raw.pointee.specifier = pointer
        raw.pointee.specifier_len = UInt(count)
        raw.pointee.specifier_type = specifierType.rawValue
        raw.pointee.priority = priority.rawValue
        raw.pointee.bundle_behavior = bundleBehavior.rawValue
        raw.pointee.flags = flags.rawValue
        raw.pointee.conditions = conditions.rawValue
        raw.pointee.import_type = importType.rawValue
        return body(raw)
      }
    }
  }
}

/// The outcome of resolving a dependency.
///
/// Parcel may add cases, so a `switch` over one needs an `@unknown default`.
@nonexhaustive
public enum ResolveResult: Hashable, Sendable {
  /// Not resolved: the next resolver gets a turn.
  case unresolved
  /// A file, built with Parcel's transformers.
  case file(ResolvedFile)
  /// Left out of the bundle, to be loaded at runtime.
  case external
  /// Silently excluded from the bundle.
  case excluded

  /// The file at the absolute `path`, optionally transformed with the named
  /// `pipeline`.
  public static func file(_ path: String, pipeline: String? = nil) -> Self {
    .file(ResolvedFile(path: path, pipeline: pipeline))
  }
}

/// The file a dependency resolved to.
///
/// A struct rather than the case's own associated values, so Parcel can add
/// details about the file without breaking plugins that match on the case.
public struct ResolvedFile: Hashable, Sendable {
  /// The file's absolute path.
  public var path: String
  /// The named pipeline to transform the file with, if any.
  public var pipeline: String?

  public init(path: String, pipeline: String? = nil) {
    self.path = path
    self.pipeline = pipeline
  }
}

/// Read-only access to a dependency.
///
/// Valid only for the duration of the plugin call it was passed to.
public struct Dependency: Sendable {
  let raw: UInt64
  let options: Options

  init(raw: UInt64, options: Options) {
    self.raw = raw
    self.options = options
  }

  @inline(__always)
  private func host<R>(_ body: () -> R) -> R {
    options.scope.shared("Dependency", body)
  }

  /// The module specifier as written, e.g. `"./foo.js"`.
  public var specifier: String {
    host { hostString { parcel_dep_get_specifier($0, raw) } ?? "" }
  }

  public var specifierType: SpecifierType {
    host { SpecifierType(rawValue: parcel_dep_get_specifier_type(raw)) }
  }

  public var priority: Priority {
    host { Priority(rawValue: parcel_dep_get_priority(raw)) }
  }

  public var bundleBehavior: BundleBehavior {
    host { BundleBehavior(rawValue: parcel_dep_get_bundle_behavior(raw)) }
  }

  public var flags: DependencyFlags {
    host { DependencyFlags(rawValue: parcel_dep_get_flags(raw)) }
  }

  /// The conditions for resolving package `exports` and `imports` fields.
  public var conditions: ExportsConditions {
    host { ExportsConditions(rawValue: parcel_dep_get_conditions(raw)) }
  }

  /// How the importing asset uses the resolved one.
  public var importType: ImportType {
    host { ImportType(rawValue: parcel_dep_get_import_type(raw)) }
  }

  /// The absolute path of the file containing the import.
  public var sourcePath: String {
    host { hostString { parcel_dep_get_source_path($0, raw, options.raw) } ?? "" }
  }

  /// The absolute path to resolve the specifier from.
  public var resolveFrom: String {
    host { hostString { parcel_dep_get_resolve_from($0, raw, options.raw) } ?? "" }
  }

  public var target: Target {
    host { Target(raw: parcel_dep_get_target(raw), options: options) }
  }
}

/// Read-only access to a build target.
///
/// Valid only for the duration of the plugin call it came from.
public struct Target: Sendable {
  let raw: UInt64
  let options: Options

  @inline(__always)
  private func host<R>(_ body: () -> R) -> R {
    options.scope.shared("Target", body)
  }

  public var environment: Environment {
    host { Environment(rawValue: parcel_target_get_environment(raw)) }
  }

  public var outputFormat: OutputFormat {
    host { OutputFormat(rawValue: parcel_target_get_output_format(raw)) }
  }

  public var sourceType: SourceType {
    host { SourceType(rawValue: parcel_target_get_source_type(raw)) }
  }

  public var environmentFlags: EnvironmentFlags {
    host { EnvironmentFlags(rawValue: parcel_target_get_env_flags(raw)) }
  }

  /// The public URL, e.g. `"/"` or `"https://cdn.example.com/"`.
  public var publicURL: String {
    host { hostString { parcel_target_get_public_url($0, raw) } ?? "" }
  }

  /// The absolute path of the dist directory.
  public var distDir: String {
    host { hostString { parcel_target_get_dist_dir($0, raw, options.raw) } ?? "" }
  }
}
