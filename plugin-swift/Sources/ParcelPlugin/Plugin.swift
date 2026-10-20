/// A native Parcel plugin.
///
/// Conform to one or more of ``Transformer``, ``Resolver``, ``Namer``,
/// ``Optimizer``, and ``Reporter``, then export the type with
/// ``parcelPlugin(_:)`` once, at file scope:
///
/// ```swift
/// struct TxtTransformer: Transformer {
///   init(config: NoConfig) {}
///
///   func transform(_ asset: Asset, options: Options) async throws {
///     asset.content = "export default \(jsonString(asset.content));"
///     asset.type = "js"
///   }
/// }
///
/// #parcelPlugin(TxtTransformer.self)
/// ```
///
/// ## Concurrency
///
/// Parcel calls one instance from many threads at once, so plugins are
/// `Sendable`; keep shared mutable state in an actor or a `Mutex`.
///
/// Each call runs as a task on the thread Parcel called in on, which runs the
/// task's work until it finishes. Awaiting an actor, I/O, or a `@concurrent`
/// function works as usual: the work happens elsewhere, and the call resumes on
/// that thread. Structured child tasks run on that thread too, one at a time; to
/// run CPU-bound work in parallel, give it to a task group with
/// `executorPreference: globalConcurrentExecutor`.
///
/// Never wait on the main actor. Parcel's main thread does not run Swift's main
/// executor, so `@MainActor` code never runs, and the call hangs.
///
/// ## Errors
///
/// Throw a ``Diagnostic`` — or any `Error` — to fail a call. Unlike Rust and Go,
/// Swift cannot recover from a trap: a failed force unwrap, an out-of-bounds
/// index, or `fatalError` aborts Parcel itself, so prefer throwing.
public protocol Plugin: Sendable {
  /// The plugin's options from the `.parcelrc`, decoded from JSON. A plugin with
  /// no options decodes from `{}`.
  associatedtype Config: Decodable & Sendable = NoConfig

  /// Called once per `.parcelrc` entry naming this plugin, when Parcel loads it.
  init(config: Config) async throws
}

/// The ``Plugin/Config`` of a plugin that takes no options.
public struct NoConfig: Decodable, Hashable, Sendable {
  public init() {}
}

/// Transforms assets: compiles them, and records their dependencies.
public protocol Transformer: Plugin {
  /// Called once for each asset matching the plugin's glob in the `.parcelrc`.
  func transform(_ asset: Asset, options: Options) async throws
}

/// Resolves dependency specifiers to files.
public protocol Resolver: Plugin {
  /// Called for each dependency that reaches this resolver. Return `nil` to pass
  /// it to the next one.
  func resolve(
    _ dependency: Dependency, specifier: String, pipeline: String?, options: Options
  ) async throws -> ResolveResult?
}

/// Names output bundles.
public protocol Namer: Plugin {
  /// Returns the bundle's path relative to its target's dist directory, or `nil`
  /// to pass it to the next namer.
  func name(_ bundle: OutputBundle, in bundleGraph: BundleGraph, options: Options) async throws
    -> String?
}

/// The output of an ``Optimizer``.
public struct OptimizeResult: Sendable {
  public var contents: Content
  /// The source map for `contents`. `nil` removes the bundle's source map.
  public var sourceMap: [UInt8]?

  public init(contents: Content, sourceMap: [UInt8]?) {
    self.contents = contents
    self.sourceMap = sourceMap
  }
}

/// Optimizes packaged bundles, e.g. by minifying them.
public protocol Optimizer: Plugin {
  /// Called for each bundle matching the plugin's glob in the `.parcelrc`, with
  /// its packaged contents and its source map, if it has one.
  func optimize(
    _ bundle: OutputBundle, in bundleGraph: BundleGraph, contents: [UInt8], sourceMap: [UInt8]?,
    options: Options
  ) async throws -> OptimizeResult
}

/// Observes builds.
///
/// Every method does nothing by default; implement those for the events you
/// want. Parcel may add events in future, which reach no method here. Errors a
/// reporter throws are reported, but cannot fail the build.
public protocol Reporter: Plugin {
  /// A build is about to start, including each rebuild.
  func buildStarted(options: Options) async throws

  /// A build finished and wrote its output.
  func buildSucceeded(_ build: BuildSuccess, options: Options) async throws

  /// A build failed. The same diagnostics are returned to whoever asked for it.
  func buildFailed(_ diagnostics: Diagnostics, options: Options) async throws

  /// Parcel or another plugin logged something.
  func log(_ entry: LogEntry, options: Options) async throws
}

extension Reporter {
  public func buildStarted(options: Options) async throws {}
  public func buildSucceeded(_ build: BuildSuccess, options: Options) async throws {}
  public func buildFailed(_ diagnostics: Diagnostics, options: Options) async throws {}
  public func log(_ entry: LogEntry, options: Options) async throws {}
}

/// Content a plugin produces: text, or arbitrary bytes.
public enum Content: Hashable, Sendable {
  case string(String)
  case bytes([UInt8])
}
