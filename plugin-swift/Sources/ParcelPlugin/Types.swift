// Values Parcel hands to plugins may come from a newer Parcel than the one this
// SDK was built against. The enumerations below are therefore structs with
// static members rather than closed `enum`s: an unknown value arrives as an
// unrecognized `rawValue` instead of failing to convert.
//
// The raw values mirror plugin.h; ConstantsTests checks them against it.

/// Index of an asset within a ``BundleGraph``.
public typealias AssetIndex = UInt32

/// Index of a bundle within a ``BundleGraph``.
public typealias BundleIndex = Int

/// How a dependency specifier is interpreted.
public struct SpecifierType: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let esm = Self(rawValue: 0)
  public static let commonJS = Self(rawValue: 1)
  public static let url = Self(rawValue: 2)
  public static let custom = Self(rawValue: 3)
}

/// When a dependency is loaded relative to the asset that imports it.
public struct Priority: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let sync = Self(rawValue: 0)
  public static let parallel = Self(rawValue: 1)
  public static let lazy = Self(rawValue: 2)
}

/// How an asset's or dependency's bundle is output.
public struct BundleBehavior: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let none = Self(rawValue: 0)
  public static let inline = Self(rawValue: 1)
  public static let isolated = Self(rawValue: 2)
}

/// The environment a target runs in.
public struct Environment: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let browser = Self(rawValue: 0)
  public static let webWorker = Self(rawValue: 1)
  public static let serviceWorker = Self(rawValue: 2)
  public static let worklet = Self(rawValue: 3)
  public static let node = Self(rawValue: 4)
  public static let electronMain = Self(rawValue: 5)
  public static let electronRenderer = Self(rawValue: 6)
  public static let reactClient = Self(rawValue: 7)
  public static let reactServer = Self(rawValue: 8)
}

/// The module format a target outputs.
public struct OutputFormat: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let global = Self(rawValue: 0)
  public static let commonJS = Self(rawValue: 1)
  public static let esModule = Self(rawValue: 2)
}

/// Whether a target expects ES module or classic script source.
public struct SourceType: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let module = Self(rawValue: 0)
  public static let script = Self(rawValue: 1)
}

/// The level of a log event, and of a message passed to ``Options/log(_:level:)``.
public struct LogLevel: RawRepresentable, Hashable, Comparable, Sendable, CustomStringConvertible {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let none = Self(rawValue: 0)
  public static let error = Self(rawValue: 1)
  public static let warn = Self(rawValue: 2)
  public static let info = Self(rawValue: 3)
  public static let verbose = Self(rawValue: 4)

  public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

  public var description: String {
    switch self {
    case .none: "none"
    case .error: "error"
    case .warn: "warn"
    case .info: "info"
    case .verbose: "verbose"
    default: "unknown"
    }
  }
}

/// How Parcel treats a ``Diagnostic``.
public struct Severity: RawRepresentable, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let error = Self(rawValue: 0)
  public static let warning = Self(rawValue: 1)
  public static let sourceError = Self(rawValue: 2)
  public static let info = Self(rawValue: 3)
}

// ── Flags ───────────────────────────────────────────────────────────────────

public struct AssetFlags: OptionSet, Hashable, Sendable {
  public var rawValue: UInt32
  public init(rawValue: UInt32) { self.rawValue = rawValue }

  public static let isSource = Self(rawValue: 1 << 0)
  public static let sideEffects = Self(rawValue: 1 << 1)
  public static let isBundleSplittable = Self(rawValue: 1 << 2)
  public static let largeBlob = Self(rawValue: 1 << 3)
  public static let hasCJSExports = Self(rawValue: 1 << 4)
  public static let staticExports = Self(rawValue: 1 << 5)
  public static let shouldWrap = Self(rawValue: 1 << 6)
  public static let isConstantModule = Self(rawValue: 1 << 7)
  public static let hasNodeReplacements = Self(rawValue: 1 << 8)
  public static let hasSymbols = Self(rawValue: 1 << 9)
  public static let isHTMLAttribute = Self(rawValue: 1 << 10)
  public static let isHTMLTag = Self(rawValue: 1 << 11)
  public static let isESM = Self(rawValue: 1 << 12)
}

public struct DependencyFlags: OptionSet, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let entry = Self(rawValue: 1 << 0)
  public static let optional = Self(rawValue: 1 << 1)
  public static let needsStableName = Self(rawValue: 1 << 2)
  public static let isWebWorker = Self(rawValue: 1 << 3)
  public static let sideEffects = Self(rawValue: 1 << 4)
  public static let macro = Self(rawValue: 1 << 5)
}

/// Conditions used when resolving package `exports` and `imports` fields.
public struct ExportsConditions: OptionSet, Hashable, Sendable {
  public var rawValue: UInt32
  public init(rawValue: UInt32) { self.rawValue = rawValue }

  public static let `import` = Self(rawValue: 1 << 0)
  public static let require = Self(rawValue: 1 << 1)
  public static let module = Self(rawValue: 1 << 2)
  public static let node = Self(rawValue: 1 << 3)
  public static let browser = Self(rawValue: 1 << 4)
  public static let worker = Self(rawValue: 1 << 5)
  public static let worklet = Self(rawValue: 1 << 6)
  public static let electron = Self(rawValue: 1 << 7)
  public static let development = Self(rawValue: 1 << 8)
  public static let production = Self(rawValue: 1 << 9)
  public static let types = Self(rawValue: 1 << 10)
  public static let `default` = Self(rawValue: 1 << 11)
  public static let style = Self(rawValue: 1 << 12)
  public static let sass = Self(rawValue: 1 << 13)
  public static let less = Self(rawValue: 1 << 14)
  public static let stylus = Self(rawValue: 1 << 15)
  public static let reactServer = Self(rawValue: 1 << 16)
  public static let source = Self(rawValue: 1 << 17)
}

public struct EnvironmentFlags: OptionSet, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let isLibrary = Self(rawValue: 1 << 0)
  public static let shouldOptimize = Self(rawValue: 1 << 1)
  public static let shouldScopeHoist = Self(rawValue: 1 << 2)
  public static let moduleTypeExtension = Self(rawValue: 1 << 3)
}

public struct BundleFlags: OptionSet, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let needsStableName = Self(rawValue: 1 << 0)
  public static let isSplittable = Self(rawValue: 1 << 1)
  public static let isPlaceholder = Self(rawValue: 1 << 2)
  public static let entry = Self(rawValue: 1 << 3)
}

/// What a path refers to. Empty when it does not exist.
public struct FileKind: OptionSet, Hashable, Sendable {
  public var rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let file = Self(rawValue: 1 << 0)
  public static let directory = Self(rawValue: 1 << 1)
  public static let symlink = Self(rawValue: 1 << 2)
}
