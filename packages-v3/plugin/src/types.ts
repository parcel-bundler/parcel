// Plugin API types for Parcel v3. These describe the objects exposed to
// JavaScript plugins by the QuickJS bindings in crates/plugin-js.
//
// Plugins log by calling `console` methods. Passing a `Diagnostic` (exported by
// `@parcel/plugin`) logs its diagnostics, with a severity matching the method's
// level unless they set one. Throwing (or rejecting) fails the plugin call. A
// thrown `Diagnostic` is reported as the diagnostics it was created with. For
// any other error, the message becomes a diagnostic, with a code frame pointing
// at `filename`/`fileName`, `line` and `column` if the error has them, or
// otherwise at the top frame of its stack. Diagnostics are attributed to the
// plugin unless they set `origin`.
//
// A plugin's methods are called with the object passed to its constructor (e.g.
// `new Transformer({...})`) as `this`, so they can call helper methods on it.
//
// Each worker thread runs plugins in its own JavaScript runtime, and calls run
// concurrently across threads. Module-level state is therefore not shared between
// calls, not even between a reporter's `log` and `buildSuccess` calls. Timers and
// I/O callbacks aren't available, so a promise must be settled by other promises
// or synchronous code.

export type FilePath = string;
export type Glob = string;
export type PackageName = string;
export type SemverRange = string;
/** See Dependency */
export type DependencySpecifier = string;

/** Plugins may return either a value or a promise for it. */
export type Async<T> = T | Promise<T>;

/** A JSON object (as in "map") */
export type JSONObject = {[key: string]: JSONValue};
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | Array<JSONValue>
  | JSONObject;

/** A source map in the standard JSON format (version 3). */
export type SourceMapJSON = {
  version: number;
  sources: Array<string>;
  mappings: string;
  names?: Array<string>;
  sourcesContent?: Array<string | null>;
  sourceRoot?: string;
  file?: string;
  [key: string]: unknown;
};

/** A source map as a JSON object, a JSON string, or UTF-8 encoded JSON. */
export type SourceMapInput = SourceMapJSON | string | Uint8Array;

/** Line/column positions are 1-based (so <code>1</code> is the first line/column). */
export type Location = {
  readonly line: number;
  readonly column: number;
};

export type SourceLocation = {
  readonly filePath: string;

  /** inclusive */
  readonly start: Location;

  /** exclusive */
  readonly end: Location;
};

/**
 *   - error: Fails the build.
 *   - warning: Logged, but does not fail the build.
 *   - sourceError: An error in source code in the project, or a warning in node_modules.
 *   - info: An informative message.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'sourceError' | 'info';

export type DiagnosticCodeHighlight = {
  /** Location of the first character that should get highlighted for this highlight. */
  start: Location;
  /** Location of the last character that should get highlighted for this highlight. Defaults to `start`. */
  end?: Location;
  /** A message that should be displayed at this location in the code. */
  message?: string | null;
};

/**
 * Describes how to format a code frame.
 * A code frame is a visualization of a piece of code with a certain amount of
 * code highlights that point to certain chunk(s) inside the code.
 */
export type DiagnosticCodeFrame = {
  /** The contents of the source file, if different from the file. If omitted, the file is read. */
  code?: string | null;
  /**
   * Absolute path of the file this code frame is about. Diagnostics passed to reporters
   * use `url` instead.
   */
  filePath?: string | null;
  /** URL of the file this code frame is about. Files on disk use `file:` URLs. */
  url?: string | null;
  /** Language (file extension) of the code, used for syntax highlighting. */
  language?: string | null;
  codeHighlights: Array<DiagnosticCodeHighlight>;
};

/**
 * A style agnostic way of emitting errors, warnings and info.
 * Reporters are responsible for rendering the message, codeframes, hints, ...
 *
 * Diagnostics passed to reporters have every field.
 */
export type DiagnosticOptions = {
  /** This is the message you want to log. */
  message: string;
  /** Name of plugin or file that threw this error. Defaults to the plugin's name in .parcelrc. */
  origin?: string | null;
  /** Code frames point to certain location(s) in the file(s) this diagnostic is linked to. */
  codeFrames?: Array<DiagnosticCodeFrame>;
  /** A list of strings that suggest ways to resolve this issue */
  hints?: Array<string>;
  /** @default 'error' */
  severity?: DiagnosticSeverity;
  /** A URL to documentation to learn more about the diagnostic. */
  documentationURL?: string | null;
};

export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'verbose';
export type BuildMode = 'development' | 'production' | string;

export type HMROptions = {
  readonly host: string;
  readonly port: number;
};

export interface PluginOptions {
  readonly mode: BuildMode;
  readonly env: Readonly<Record<string, string>>;
  readonly logLevel: LogLevel;
  readonly hmrOptions: HMROptions | undefined;
  readonly projectRoot: FilePath;
}

/**
 * Corresponds to <code>pkg#engines</code>, resolved to minimum versions, which are
 * formatted like `>= 18.2`.
 */
export type Engines = {
  /** The minimum browser versions, e.g. `chrome >= 63, firefox >= 67, safari >= 11.1`. Empty if none. */
  readonly browsers: string;
  readonly electron: string | null;
  readonly node: string | null;
  readonly parcel: string | null;
};

/** Corresponds to <code>pkg#targets.*.sourceMap</code> */
export type TargetSourceMapOptions = {
  readonly sourceRoot: string | null;
  readonly inline: boolean | null;
  readonly inlineSources: boolean | null;
};

/** In which environment the output should run (influces e.g. bundle loaders) */
export type EnvironmentContext =
  | 'browser'
  | 'web-worker'
  | 'service-worker'
  | 'worklet'
  | 'node'
  | 'electron-main'
  | 'electron-renderer'
  | 'react-client'
  | 'react-server';

/** The JS module format for the bundle output */
export type OutputFormat = 'esmodule' | 'commonjs' | 'global';

export type SourceType = 'script' | 'module';

/**
 * Where and how an asset or bundle will run.
 */
export interface Target {
  /** The output folder */
  readonly distDir: FilePath;
  readonly publicUrl: string;
  readonly engines: Engines;

  /** Whether to include all/none packages \
   *  (<code>true / false</code>), an array of package names to include, or an object \
   *  (of a package is not specified, it's included).
   */
  readonly includeNodeModules:
    | boolean
    | Array<PackageName>
    | Record<PackageName, boolean>;
  readonly sourceMap: TargetSourceMapOptions | null;
  readonly environment: EnvironmentContext;
  readonly outputFormat: OutputFormat;
  readonly sourceType: SourceType;

  /** Whether this is a library build (e.g. less loaders) */
  readonly isLibrary: boolean;

  /** Whether the output should be minified. */
  readonly shouldOptimize: boolean;

  /** Whether <code>environment</code> specifies a browser context. */
  isBrowser(): boolean;

  /** Whether <code>environment</code> specifies a node context. */
  isNode(): boolean;

  /** Whether <code>environment</code> specifies an electron context. */
  isElectron(): boolean;

  /** Whether <code>environment</code> specifies a server context (node or react-server). */
  isServer(): boolean;

  /** Whether <code>environment</code> specifies a worker context. */
  isWorker(): boolean;

  /** Whether <code>environment</code> specifies a worklet context. */
  isWorklet(): boolean;
}

export type DependencyPriority = 'sync' | 'parallel' | 'lazy';
export type SpecifierType = 'commonjs' | 'esm' | 'url' | 'custom';
export type BundleBehavior = 'inline' | 'isolated';

/**
 * How the resolved asset is used by the importing asset.
 *   - javascript: Imported as a JavaScript module.
 *   - stylesheet: Imported as a CSS stylesheet.
 *   - url: Referenced by URL.
 *   - text: Imported as a string.
 *   - bytes: Imported as binary data.
 */
export type ImportType = 'javascript' | 'stylesheet' | 'url' | 'text' | 'bytes';

/** The package.json "exports" and "imports" conditions supported by Parcel. */
export type PackageCondition =
  | 'import'
  | 'require'
  | 'module'
  | 'node'
  | 'browser'
  | 'worker'
  | 'worklet'
  | 'electron'
  | 'development'
  | 'production'
  | 'types'
  | 'default'
  | 'style'
  | 'sass'
  | 'less'
  | 'stylus'
  | 'react-server'
  | 'source';

/**
 * A package.json "exports" or "imports" condition. Parcel knows the `PackageCondition`s; any other
 * string is a custom condition, which matches only itself.
 */
export type PackageConditionName = PackageCondition | (string & {});

/**
 * Used when creating a Dependency, see that.
 * @section transformer
 */
export type DependencyOptions = {
  /** The specifier used to resolve the dependency. */
  readonly specifier: DependencySpecifier;

  /**
   * How the specifier should be interpreted.
   *   - esm: An ES module specifier. It is parsed as a URL, but bare specifiers are treated as node_modules.
   *   - commonjs: A CommonJS specifier. It is not parsed as a URL.
   *   - url: A URL that works as in a browser. Bare specifiers are treated as relative URLs.
   *   - custom: A custom specifier. Must be handled by a custom resolver plugin.
   * @default 'esm'
   */
  readonly specifierType?: SpecifierType | null;

  /**
   * When the dependency should be loaded.
   *   - sync: The dependency should be resolvable synchronously. The resolved asset will be placed
   *       in the same bundle as the parent, or another bundle that's already on the page.
   *   - parallel: The dependency should be placed in a separate bundle that's loaded in parallel
   *       with the current bundle.
   *   - lazy: The dependency should be placed in a separate bundle that's loaded later.
   * @default 'sync'
   */
  readonly priority?: DependencyPriority | null;

  /**
   * Controls the behavior of the bundle the resolved asset is placed into. Use in combination with `priority`
   * to determine when the bundle is loaded.
   *   - inline: The resolved asset will be placed into a new inline bundle. Inline bundles are not written
   *       to a separate file, but embedded into the parent bundle.
   *   - isolated: The resolved asset will be isolated from its parents in a separate bundle.
   *       Shared assets will be duplicated.
   */
  readonly bundleBehavior?: BundleBehavior | 'none' | null;

  /**
   * How the resolved asset is used by the importing asset.
   * @default 'javascript'
   */
  readonly importType?: ImportType | null;

  /**
   * When the dependency is a bundle entry (priority is "parallel" or "lazy"), this controls the naming
   * of that bundle. `needsStableName` indicates that the name should be stable over time, even when the
   * content of the bundle changes. This is useful for entries that a user would manually enter the URL
   * for, as well as for things like service workers or RSS feeds, where the URL must remain consistent
   * over time.
   */
  readonly needsStableName?: boolean | null;

  /** Whether the dependency is optional. If the dependency cannot be resolved, this will not fail the build. */
  readonly isOptional?: boolean | null;

  /** Whether the dependency is an entry. */
  readonly isEntry?: boolean | null;

  /** Whether the dependency has side effects. */
  readonly sideEffects?: boolean | null;

  /**
   * The location within the source file where the dependency was found.
   * `filePath` may be an absolute path or a URL, and defaults to the asset's.
   */
  readonly loc?: {
    readonly filePath?: string | null;
    readonly start: Location;
    readonly end: Location;
  } | null;

  /**
   * The target to resolve the dependency in. Must be a Target obtained from Parcel,
   * e.g. from an asset or dependency. Defaults to the asset's target.
   */
  readonly target?: Target | null;

  /** A list of package.json "exports" and "imports" conditions to use when resolving the dependency. */
  readonly packageConditions?: Array<PackageConditionName> | null;

  /** The pipeline defined in .parcelrc that the dependency should be processed with. */
  readonly pipeline?: string | null;

  /**
   * The absolute file path or URL where the dependency should be resolved from.
   * By default, this is the source file where the dependency was specified.
   */
  readonly resolveFrom?: string | null;

  /** The semver version range expected for the dependency. */
  readonly range?: SemverRange | null;
};

/**
 * A Dependency denotes a connection between two assets \
 * (likely some effect from the importee is expected - be it a side effect or a value is being imported).
 *
 * @section transformer
 */
export interface Dependency {
  /** The specifier used to resolve the dependency. */
  readonly specifier: DependencySpecifier;

  /**
   * How the specifier should be interpreted.
   *   - esm: An ES module specifier. It is parsed as a URL, but bare specifiers are treated as node_modules.
   *   - commonjs: A CommonJS specifier. It is not parsed as a URL.
   *   - url: A URL that works as in a browser. Bare specifiers are treated as relative URLs.
   *   - custom: A custom specifier. Must be handled by a custom resolver plugin.
   */
  readonly specifierType: SpecifierType;

  /**
   * When the dependency should be loaded.
   *   - sync: The dependency should be resolvable synchronously. The resolved asset will be placed
   *       in the same bundle as the parent, or another bundle that's already on the page.
   *   - parallel: The dependency should be placed in a separate bundle that's loaded in parallel
   *       with the current bundle.
   *   - lazy: The dependency should be placed in a separate bundle that's loaded later.
   */
  readonly priority: DependencyPriority;

  /**
   * Controls the behavior of the bundle the resolved asset is placed into. Use in combination with `priority`
   * to determine when the bundle is loaded.
   *   - inline: The resolved asset will be placed into a new inline bundle. Inline bundles are not written
   *       to a separate file, but embedded into the parent bundle.
   *   - isolated: The resolved asset will be isolated from its parents in a separate bundle.
   *       Shared assets will be duplicated.
   */
  readonly bundleBehavior: BundleBehavior | undefined;

  /** How the resolved asset is used by the importing asset. */
  readonly importType: ImportType;

  /**
   * When the dependency is a bundle entry (priority is "parallel" or "lazy"), this controls the naming
   * of that bundle. `needsStableName` indicates that the name should be stable over time, even when the
   * content of the bundle changes. This is useful for entries that a user would manually enter the URL
   * for, as well as for things like service workers or RSS feeds, where the URL must remain consistent
   * over time.
   */
  readonly needsStableName: boolean;

  /** Whether the dependency is optional. If the dependency cannot be resolved, this will not fail the build. */
  readonly isOptional: boolean;

  /** Whether the dependency is an entry. */
  readonly isEntry: boolean;

  /** Whether the dependency has side effects. */
  readonly sideEffects: boolean;

  /** The location within the source file where the dependency was found. */
  readonly loc: SourceLocation | undefined;

  /** The target the dependency is resolved in. */
  readonly target: Target;

  /** The package.json "exports" and "imports" conditions used to resolve the dependency. */
  readonly packageConditions: Array<PackageConditionName>;

  /**
   * The path of the file the dependency is resolved from: the `resolveFrom` it was created with,
   * or else the file it was found in. `undefined` when that is not a file on disk.
   */
  readonly resolveFrom: FilePath | undefined;

  /** The semver version range expected for the dependency. */
  readonly range: SemverRange | undefined;

  /**
   * A unique string that a transformer can embed in the asset's content to refer to the
   * dependency. It is replaced with the resolved bundle URL or module id during packaging.
   */
  readonly placeholder: string | undefined;
}

/**
 * An asset represents a file or part of a file. It may represent any data type, including source code,
 * binary data, etc. Assets may exist in the file system or may be virtual.
 *
 * Assets passed to namers, optimizers and reporters are read-only, and can only be
 * accessed during the plugin call they were passed to.
 *
 * @section transformer
 */
export interface Asset {
  /** The URL of the asset, including its query. Files on disk use `file:` URLs. */
  readonly url: string;

  /** The file path of the asset. */
  readonly filePath: FilePath;

  /**
   * The asset's type. This initially corresponds to the source file extension,
   * but it may be changed during transformation.
   */
  readonly type: string;

  /** The target of the asset. */
  readonly target: Target;

  /**
   * Whether this asset is part of the project, and not an external dependency (e.g. in node_modules).
   * This indicates that transformation using the project's configuration should be applied.
   */
  readonly isSource: boolean;

  /**
   * Controls which bundle the asset is placed into.
   *   - inline: The asset will be placed into a new inline bundle. Inline bundles are not written
   *       to a separate file, but embedded into the parent bundle.
   *   - isolated: The asset will be isolated from its parents in a separate bundle. Shared assets
   *       will be duplicated.
   */
  readonly bundleBehavior: BundleBehavior | undefined;

  /**
   * Whether this asset can be omitted if none of its exports are being used.
   * This is initially set by the resolver, but can be overridden by transformers.
   */
  readonly sideEffects: boolean;

  /** A key that identifies the asset, set by a transformer. */
  readonly uniqueKey: string | undefined;

  /** The pipeline defined in .parcelrc that the asset should be processed with. */
  readonly pipeline: string | undefined;

  /** Returns the asset contents as a string. */
  getCode(): string;

  /** Returns the asset contents as bytes. */
  getBuffer(): Uint8Array;

  /** Returns a copy of the source map for the asset, if available. */
  getMap(): SourceMapJSON | null;

  /** Returns a snapshot of the asset's dependencies. */
  getDependencies(): Array<Dependency>;
}

/**
 * A mutable Asset, available during transformation.
 * @section transformer
 */
export interface MutableAsset extends Asset {
  /**
   * The asset's type. This initially corresponds to the source file extension,
   * but it may be changed during transformation.
   */
  type: string;

  /**
   * Controls which bundle the asset is placed into.
   *   - inline: The asset will be placed into a new inline bundle. Inline bundles are not written
   *       to a separate file, but embedded into the parent bundle.
   *   - isolated: The asset will be isolated from its parents in a separate bundle. Shared assets
   *       will be duplicated.
   *
   * Setting any other value throws a TypeError.
   */
  get bundleBehavior(): BundleBehavior | undefined;
  set bundleBehavior(value: BundleBehavior | 'none' | null | undefined);

  /**
   * Whether this asset can be omitted if none of its exports are being used.
   * This is initially set by the resolver, but can be overridden by transformers.
   */
  sideEffects: boolean;

  /** A key that identifies the asset. It can only be set once. */
  get uniqueKey(): string | undefined;
  set uniqueKey(value: string | null | undefined);

  /** The pipeline defined in .parcelrc that the asset should be processed with. */
  get pipeline(): string | undefined;
  set pipeline(value: string | null | undefined);

  /**
   * Adds a dependency to the asset. Returns the dependency's placeholder, which can be
   * embedded in the asset's content to refer to the resolved dependency.
   */
  addDependency(options: DependencyOptions): string;

  /**
   * Adds a url dependency to the asset.
   * This is a shortcut for addDependency that defaults the specifierType and importType
   * to 'url' and the priority to 'lazy'. Returns the dependency's placeholder.
   */
  addURLDependency(
    url: string,
    options?: Partial<Omit<DependencyOptions, 'specifier'>>,
  ): string;

  /**
   * Sets the asset contents as a string, and optionally its source map. A map that isn't a JSON
   * object throws a TypeError.
   */
  setCode(code: string, map?: SourceMapInput | null): void;

  /**
   * Sets the asset contents as bytes, and optionally its source map. A map that isn't a JSON
   * object throws a TypeError.
   */
  setBuffer(buffer: Uint8Array, map?: SourceMapInput | null): void;
}

/**
 * A Bundle (a collection of assets)
 *
 * Bundles can only be accessed during the plugin call they were passed to.
 *
 * @section bundler
 */
export interface Bundle {
  /** The type of the bundle. */
  readonly type: string;

  /** The bundle's target. */
  readonly target: Target;

  /** Whether the bundle is an entry. */
  readonly isEntry: boolean;

  /**
   * Indicates that the bundle's file name should be stable over time, even when the content of the bundle
   * changes. This is useful for entries that a user would manually enter the URL for, as well as for things
   * like service workers or RSS feeds, where the URL must remain consistent over time.
   */
  readonly needsStableName: boolean;

  /**
   * Controls the behavior of the bundle.
   *   - inline: Inline bundles are not written to a separate file, but embedded into the parent bundle.
   *   - isolated: The bundle will be isolated from its parents. Shared assets will be duplicated.
   */
  readonly bundleBehavior: BundleBehavior | undefined;

  /**
   * A placeholder for the bundle's content hash. A namer must include it exactly once in the
   * name of a bundle that may be content hashed. It is replaced with a content hash of the
   * bundle after packaging and optimizing.
   */
  readonly hashReference: string;

  /**
   * The absolute path the bundle is written to, once it is known. `null` for inline bundles,
   * before the bundle is named, and while a content hashed name is unknown.
   */
  readonly filePath: FilePath | null;

  /**
   * The bundle's name: its file path relative to its target's <code>distDir</code>.
   * `null` until it can be read, i.e. before the bundle is named, or while a content hashed
   * name is unknown.
   */
  readonly name: string | null;

  /**
   * Returns the assets that are executed immediately when the bundle is loaded.
   * Some bundles may not have any entry assets, for example, shared bundles.
   */
  getEntryAssets(): Array<Asset>;

  /**
   * Returns the main entry of the bundle, which will provide the bundle's exports.
   * Some bundles do not have a main entry, for example, shared bundles.
   */
  getMainEntry(): Asset | undefined;

  /** Returns whether the bundle includes the given asset. */
  hasAsset(asset: Asset): boolean;
}

/**
 * A Graph that contains Bundle-s.
 * @section bundler
 */
export interface BundleGraph {
  /** Returns a list of bundles in the bundle graph. */
  getBundles(): Array<Bundle>;

  /** Returns a list of entry bundles. */
  getEntryBundles(): Array<Bundle>;

  /** Returns a list of bundles that are referenced by this bundle. */
  getReferencedBundles(
    bundle: Bundle,
    options?: {
      recursive?: boolean;
    },
  ): Array<Bundle>;

  /**
   * Returns the bundles that code in the bundle's execution context may load: everything
   * reachable through bundle references and Parcel's loader, without entering other
   * execution contexts (e.g. workers). The bundle itself is not included.
   */
  getBundlesInBundleGroup(bundle: Bundle): Array<Bundle>;

  /**
   * Returns the bundles that dependencies of the bundle's assets resolve to,
   * e.g. lazy, isolated, inline and URL references.
   */
  getBundleDependencies(bundle: Bundle): Array<Bundle>;

  /** Returns the asset that the dependency resolved to, if any. */
  getResolvedAsset(dependency: Dependency): Asset | undefined;

  /** Returns the bundle that the dependency references, if it resolved to another bundle. */
  getReferencedBundle(dependency: Dependency): Bundle | undefined;
}

/**
 * @section transformer
 */
export type ResolveOptions = {
  /**
   * How the specifier should be interpreted.
   *   - esm: An ES module specifier. It is parsed as a URL, but bare specifiers are treated as node_modules.
   *   - commonjs: A CommonJS specifier. It is not parsed as a URL.
   *   - url: A URL that works as in a browser. Bare specifiers are treated as relative URLs.
   *   - custom: A specifier only a resolver plugin knows how to interpret.
   * @default 'esm'
   */
  readonly specifierType?: SpecifierType;

  /**
   * How the resolved file is used, as for a dependency. A file resolved as `javascript` must have a
   * transformer that turns it into JavaScript, or resolving it fails. Use `url` to resolve any file,
   * e.g. to read it yourself.
   * @default 'javascript'
   */
  readonly importType?: ImportType;

  /** A list of conditions to use when resolving package.json "exports" and "imports". */
  readonly packageConditions?: Array<PackageConditionName>;
};

/**
 * What a `ResolveFn` resolved a specifier to: a file, or an external or excluded dependency.
 * @section transformer
 */
export type ResolvedFile =
  | {
      /** The absolute path of the resolved file. */
      readonly filePath: FilePath;
      /** The named pipeline the resolver chose for the file, if any. */
      readonly pipeline: string | null;
      /** The query the resolver gave the file, if any. */
      readonly query: string | null;
      /** Corresponds to Asset's <code>sideEffects</code>. */
      readonly sideEffects: boolean;
      readonly isExternal?: undefined;
      readonly isExcluded?: undefined;
    }
  | {
      readonly isExternal: true;
      readonly filePath?: undefined;
      readonly isExcluded?: undefined;
    }
  | {
      readonly isExcluded: true;
      readonly filePath?: undefined;
      readonly isExternal?: undefined;
    };

/**
 * Resolves `specifier` from the file `from` with the resolvers configured in .parcelrc, exactly as
 * a dependency of the asset would be. Returns `null` when no resolver resolves it. Rejects with a
 * `Diagnostic` carrying the resolvers' diagnostics when one fails, which reports them unchanged
 * if thrown. Every file the resolvers read invalidates the asset.
 * @section transformer
 */
export type ResolveFn = (
  from: FilePath,
  specifier: string,
  options?: ResolveOptions,
) => Promise<ResolvedFile | null>;

/**
 * The methods for a transformer plugin.
 *
 * `config` is the configuration given for the plugin in .parcelrc, if any.
 * @section transformer
 */
export type Transformer<ConfigType> = {
  /** Transform the asset in place. */
  transform(args: {
    asset: MutableAsset;
    config: ConfigType;
    resolve: ResolveFn;
    options: PluginOptions;
  }): Async<void>;
};

/**
 * @section resolver
 */
export type ResolveResult = {
  /** An absolute path to the resolved file. */
  readonly filePath?: FilePath | null;

  /**
   * An optional named pipeline to use to compile the resolved file. Defaults to the
   * dependency's pipeline. `null` removes the pipeline.
   */
  readonly pipeline?: string | null;

  /** Query parameters to be used by transformers when compiling the resolved file. */
  readonly query?: URLSearchParams | string | null;

  /** Whether the resolved file should be excluded from the build. */
  readonly isExcluded?: boolean | null;

  /** Whether the dependency should be left out of the bundle, to be loaded at runtime. */
  readonly isExternal?: boolean | null;

  /** Corresponds to Asset's <code>sideEffects</code>. */
  readonly sideEffects?: boolean | null;

  /** The code of the resolved asset. If provided, this is used rather than reading the file from disk. */
  readonly code?: string | null;
};

/**
 * `config` is the configuration given for the plugin in .parcelrc, if any.
 * @section resolver
 */
export type Resolver<ConfigType> = {
  /**
   * Resolve a dependency, or return nullish to leave it to the next resolver plugin. Returning
   * anything else that isn't an object throws.
   */
  resolve(args: {
    dependency: Dependency;
    specifier: DependencySpecifier;
    pipeline: string | undefined;
    config: ConfigType;
    options: PluginOptions;
  }): Async<ResolveResult | null | undefined>;
};

/**
 * `config` is the configuration given for the plugin in .parcelrc, if any.
 * @section namer
 */
export type Namer<ConfigType> = {
  /**
   * Return a file path for <code>bundle</code>, relative to its target's <code>distDir</code>,
   * or nullish or `""` to leave it to the next namer plugin. A path that leaves the
   * <code>distDir</code>, e.g. an absolute one, fails the build.
   */
  name(args: {
    bundle: Bundle;
    bundleGraph: BundleGraph;
    config: ConfigType;
    options: PluginOptions;
  }): Async<FilePath | null | undefined>;
};

/**
 * @section optimizer
 */
export type OptimizerResult = {
  readonly contents: string | Uint8Array;
  /** The source map for the optimized contents. */
  readonly map?: SourceMapInput | null;
};

/**
 * `config` is the configuration given for the plugin in .parcelrc, if any.
 * @section optimizer
 */
export type Optimizer<ConfigType> = {
  optimize(args: {
    bundle: Bundle;
    bundleGraph: BundleGraph;
    contents: Uint8Array;
    /** The source map for the bundle. */
    map: SourceMapJSON | null;
    config: ConfigType;
    options: PluginOptions;
  }): Async<OptimizerResult>;
};

/**
 * Passed to every reporter method alongside the event's own fields.
 * @section reporter
 */
export type ReporterContext<ConfigType> = {
  readonly config: ConfigType;
  readonly options: PluginOptions;
};

/**
 * The build just started.
 * @section reporter
 */
export type BuildStartEvent<ConfigType> = ReporterContext<ConfigType>;

/**
 * The build was successful.
 * @section reporter
 */
export type BuildSuccessEvent<ConfigType> = ReporterContext<ConfigType> & {
  readonly bundleGraph: BundleGraph;
  /** The duration of the build, in milliseconds. */
  readonly buildTime: number;
  /** The assets transformed by this build. On a full build, that is every asset. */
  readonly changedAssets: Array<Asset>;
};

/**
 * The build failed.
 * @section reporter
 */
export type BuildFailureEvent<ConfigType> = ReporterContext<ConfigType> & {
  readonly diagnostics: Array<DiagnosticOptions>;
};

/**
 * A message was logged, either as text or as diagnostics.
 * @section reporter
 */
export type LogEvent<ConfigType> = ReporterContext<ConfigType> & {
  readonly level: Exclude<LogLevel, 'none'>;
} & (
    | {
        readonly message: string;
        readonly diagnostics?: undefined;
      }
    | {
        readonly message?: undefined;
        readonly diagnostics: Array<DiagnosticOptions>;
      }
  );

/**
 * A reporter must implement at least one of these methods.
 *
 * `config` is the configuration given for the plugin in .parcelrc, if any.
 * @section reporter
 */
export type Reporter<ConfigType> = {
  buildStart?: (event: BuildStartEvent<ConfigType>) => Async<void>;
  buildSuccess?: (event: BuildSuccessEvent<ConfigType>) => Async<void>;
  buildFailure?: (event: BuildFailureEvent<ConfigType>) => Async<void>;
  log?: (event: LogEvent<ConfigType>) => Async<void>;
};
