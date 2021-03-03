// @flow strict-local

import type {Readable} from 'stream';
import type SourceMap from '@parcel/source-map';
import type {FileSystem} from '@parcel/fs';
import type WorkerFarm from '@parcel/workers';
import type {PackageManager} from '@parcel/package-manager';
import type {Diagnostic} from '@parcel/diagnostic';
import type {PluginLogger} from '@parcel/logger';

import type {AST as _AST, ConfigResult as _ConfigResult} from './unsafe';

/** Plugin-specific AST, <code>any</code> */
export type AST = _AST;
export type ConfigResult = _ConfigResult;
/** Plugin-specific config result, <code>any</code> */
export type ConfigResultWithFilePath = {|
  contents: ConfigResult,
  filePath: FilePath,
|};
/** <code>process.env</code> */
export type EnvMap = typeof process.env;

export type QueryParameters = {[key: string]: string, ...};

export type JSONValue =
  | null
  | void // ? Is this okay?
  | boolean
  | number
  | string
  | Array<JSONValue>
  | JSONObject;

/** A JSON object (as in "map") */
export type JSONObject = {[key: string]: JSONValue, ...};

export type PackageName = string;
export type FilePath = string;
export type Glob = string;
export type Semver = string;
export type SemverRange = string;
/** See Dependency */
export type ModuleSpecifier = string;

/** A pipeline as specified in the config mapping to <code>T</code>  */
export type GlobMap<T> = {[Glob]: T, ...};

export type RawParcelConfigPipeline = Array<PackageName>;

export type HMROptions = {port?: number, host?: string, ...};

/** The format of .parcelrc  */
export type RawParcelConfig = {|
  extends?: PackageName | FilePath | Array<PackageName | FilePath>,
  resolvers?: RawParcelConfigPipeline,
  transformers?: {[Glob]: RawParcelConfigPipeline, ...},
  bundler?: PackageName,
  namers?: RawParcelConfigPipeline,
  runtimes?: {[EnvironmentContext]: RawParcelConfigPipeline, ...},
  packagers?: {[Glob]: PackageName, ...},
  optimizers?: {[Glob]: RawParcelConfigPipeline, ...},
  reporters?: RawParcelConfigPipeline,
  validators?: {[Glob]: RawParcelConfigPipeline, ...},
|};

/** A .parcelrc where all package names are resolved */
export type ResolvedParcelConfigFile = {|
  ...RawParcelConfig,
  +filePath: FilePath,
  +resolveFrom?: FilePath,
|};

/** Corresponds to <code>pkg#engines</code> */
export type Engines = {
  +browsers?: string | Array<string>,
  +electron?: SemverRange,
  +node?: SemverRange,
  +parcel?: SemverRange,
  ...
};

/** Corresponds to <code>pkg#targets.*.sourceMap</code> */
export type TargetSourceMapOptions = {|
  +sourceRoot?: string,
  +inline?: boolean,
  +inlineSources?: boolean,
|};

/**
 * A parsed version of PackageTargetDescriptor
 */
export interface Target {
  /** The output filename of the entry */
  +distEntry: ?FilePath;
  /** The output folder */
  +distDir: FilePath;
  +env: Environment;
  +name: string;
  +publicUrl: string;
  /** The location that created this Target, e.g. `package.json#main`*/
  +loc: ?SourceLocation;
}

/** In which environment the output should run (influces e.g. bundle loaders) */
export type EnvironmentContext =
  | 'browser'
  | 'web-worker'
  | 'service-worker'
  | 'node'
  | 'electron-main'
  | 'electron-renderer';

/** The JS module format for the bundle output */
export type OutputFormat = 'esmodule' | 'commonjs' | 'global';

/**
 * The format of <code>pkg#targets.*</code>
 *
 * See Environment and Target.
 */
export type PackageTargetDescriptor = {|
  +context?: EnvironmentContext,
  +engines?: Engines,
  +includeNodeModules?:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...},
  +outputFormat?: OutputFormat,
  +publicUrl?: string,
  +distDir?: FilePath,
  +sourceMap?: boolean | TargetSourceMapOptions,
  +isLibrary?: boolean,
  +optimize?: boolean,
  +scopeHoist?: boolean,
  +source?: FilePath | Array<FilePath>,
|};

/**
 * The target format when using the JS API.
 *
 * (Same as PackageTargetDescriptor, but <code>distDir</code> is required.)
 */
export type TargetDescriptor = {|
  ...PackageTargetDescriptor,
  +distDir: FilePath,
  +distEntry?: FilePath,
|};

/**
 * This is used when creating an Environment (see that).
 */
export type EnvironmentOptions = {|
  +context?: EnvironmentContext,
  +engines?: Engines,
  +includeNodeModules?:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...},
  +outputFormat?: OutputFormat,
  +isLibrary?: boolean,
  +shouldOptimize?: boolean,
  +shouldScopeHoist?: boolean,
  +sourceMap?: ?TargetSourceMapOptions,
|};

/**
 * A resolved browserslist, e.g.:
 * <pre><code>
 * {
 *   edge: '76',
 *   firefox: '67',
 *   chrome: '63',
 *   safari: '11.1',
 *   opera: '50',
 * }
 * </code></pre>
 */
export type VersionMap = {
  [string]: string,
  ...,
};

/**
 * Defines the environment in for the output bundle
 */
export interface Environment {
  +context: EnvironmentContext;
  +engines: Engines;
  /** Whether to include all/none packages \
   *  (<code>true / false</code>), an array of package names to include, or an object \
   *  (of a package is not specified, it's included).
   */
  +includeNodeModules:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...};
  +outputFormat: OutputFormat;
  /** Whether this is a library build (e.g. less loaders) */
  +isLibrary: boolean;
  /** Whether the output should be minified. */
  +shouldOptimize: boolean;
  /** Whether scope hoisting is enabled. */
  +shouldScopeHoist: boolean;
  +sourceMap: ?TargetSourceMapOptions;

  /** Whether <code>context</code> specifies a browser context. */
  isBrowser(): boolean;
  /** Whether <code>context</code> specifies a node context. */
  isNode(): boolean;
  /** Whether <code>context</code> specifies an electron context. */
  isElectron(): boolean;
  /** Whether <code>context</code> specifies a worker context. */
  isWorker(): boolean;
  /** Whether <code>context</code> specifies an isolated context (can't access other loaded ancestor bundles). */
  isIsolated(): boolean;
  matchesEngines(minVersions: VersionMap): boolean;
}

/**
 * Format of <code>pkg#dependencies</code>, <code>pkg#devDependencies</code>, <code>pkg#peerDependencies</code>
 */
type PackageDependencies = {|
  [PackageName]: Semver,
|};

/**
 * Format of <code>package.json</code>
 */
export type PackageJSON = {
  name: PackageName,
  version: Semver,
  main?: FilePath,
  module?: FilePath,
  types?: FilePath,
  browser?: FilePath | {[FilePath]: FilePath | boolean, ...},
  source?: FilePath | Array<FilePath>,
  alias?: {[PackageName | FilePath | Glob]: PackageName | FilePath, ...},
  browserslist?: Array<string> | {[string]: Array<string>},
  engines?: Engines,
  targets?: {[string]: PackageTargetDescriptor, ...},
  dependencies?: PackageDependencies,
  devDependencies?: PackageDependencies,
  peerDependencies?: PackageDependencies,
  sideEffects?: boolean | FilePath | Array<FilePath>,
  bin?: string | {|[string]: FilePath|},
  ...
};

export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'verbose';
export type BuildMode = 'development' | 'production' | string;
export type DetailedReportOptions = {|
  assetsPerBundle?: number,
|};

export type InitialParcelOptions = {|
  +entries?: FilePath | Array<FilePath>,
  +entryRoot?: FilePath,
  +config?: ModuleSpecifier,
  +defaultConfig?: ModuleSpecifier,
  +env?: EnvMap,
  +targets?: ?(Array<string> | {+[string]: TargetDescriptor, ...}),

  +shouldDisableCache?: boolean,
  +cacheDir?: FilePath,
  +mode?: BuildMode,
  +hmrOptions?: ?HMROptions,
  +shouldContentHash?: boolean,
  +serveOptions?: InitialServerOptions | false,
  +shouldAutoInstall?: boolean,
  +logLevel?: LogLevel,
  +shouldProfile?: boolean,
  +shouldPatchConsole?: boolean,
  +shouldBuildLazily?: boolean,

  +inputFS?: FileSystem,
  +outputFS?: FileSystem,
  +workerFarm?: WorkerFarm,
  +packageManager?: PackageManager,
  +detailedReport?: ?DetailedReportOptions,

  +defaultTargetOptions?: {|
    +shouldOptimize?: boolean,
    +shouldScopeHoist?: boolean,
    +sourceMaps?: boolean,
    +publicUrl?: string,
    +distDir?: FilePath,
    +engines?: Engines,
  |},

  +additionalReporters?: Array<{|
    packageName: ModuleSpecifier,
    resolveFrom: FilePath,
  |}>,

  // throwErrors
  // global?
|};

export type InitialServerOptions = {|
  +publicUrl?: string,
  +host?: string,
  +port: number,
  +https?: HTTPSOptions | boolean,
|};

export interface PluginOptions {
  +mode: BuildMode;
  +env: EnvMap;
  +hmrOptions: ?HMROptions;
  +serveOptions: ServerOptions | false;
  +shouldBuildLazily: boolean;
  +shouldAutoInstall: boolean;
  +logLevel: LogLevel;
  +entryRoot: FilePath;
  +projectRoot: FilePath;
  +cacheDir: FilePath;
  +inputFS: FileSystem;
  +outputFS: FileSystem;
  +packageManager: PackageManager;
  +instanceId: string;
  +detailedReport: ?DetailedReportOptions;
}

export type ServerOptions = {|
  +distDir: FilePath,
  +host?: string,
  +port: number,
  +https?: HTTPSOptions | boolean,
  +publicUrl?: string,
|};

export type HTTPSOptions = {|
  +cert: FilePath,
  +key: FilePath,
|};

/**
 * Source locations are 1-based, meaning lines and columns start at 1
 */
export type SourceLocation = {|
  +filePath: string,
  /** inclusive */
  +start: {|
    +line: number,
    +column: number,
  |},
  /** exclusive */
  +end: {|
    +line: number,
    +column: number,
  |},
|};

/**
 * An object that plugins can write arbitatry data to.
 */
export type Meta = JSONObject;

/**
 * An identifier in an asset (likely imported/exported).
 */
export type Symbol = string;

/**
 * A map from extert names to the corespinding asset's lcoal variable name.
 */
export interface AssetSymbols // eslint-disable-next-line no-undef
  extends Iterable<
    [Symbol, {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|}],
  > {
  /**
   * The exports of the asset are unknown, rather than just empty.
   * This is the default state.
   */
  +isCleared: boolean;
  get(
    exportSymbol: Symbol,
  ): ?{|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|};
  hasExportSymbol(exportSymbol: Symbol): boolean;
  hasLocalSymbol(local: Symbol): boolean;
  exportSymbols(): Iterable<Symbol>;
}
export interface MutableAssetSymbols extends AssetSymbols {
  /**
   * Initilizes the map, sets isCleared to false.
   */
  ensure(): void;
  set(
    exportSymbol: Symbol,
    local: Symbol,
    loc: ?SourceLocation,
    meta?: ?Meta,
  ): void;
  delete(exportSymbol: Symbol): void;
}
/**
 * isWeak means: the symbol is not used by the parent asset itself and is merely reexported
 */
export interface MutableDependencySymbols // eslint-disable-next-line no-undef
  extends Iterable<
    [
      Symbol,
      {|local: Symbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|},
    ],
  > {
  /**
   * Initilizes the map, sets isCleared to false.
   */
  ensure(): void;
  /**
   * The symbols taht are imports are unknown, rather than just empty.
   * This is the default state.
   */
  +isCleared: boolean;
  get(
    exportSymbol: Symbol,
  ): ?{|local: Symbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|};
  hasExportSymbol(exportSymbol: Symbol): boolean;
  hasLocalSymbol(local: Symbol): boolean;
  exportSymbols(): Iterable<Symbol>;
  set(
    exportSymbol: Symbol,
    local: Symbol,
    loc: ?SourceLocation,
    isWeak: ?boolean,
  ): void;
  delete(exportSymbol: Symbol): void;
}

/**
 * Usen when creating a Dependency, see that.
 * @section transformer
 */
export type DependencyOptions = {|
  +moduleSpecifier: ModuleSpecifier,
  +isAsync?: boolean,
  /** Is merged with the environment of the importer */
  +isEntry?: boolean,
  +isOptional?: boolean,
  +isURL?: boolean,
  +isIsolated?: boolean,
  +loc?: SourceLocation,
  +env?: EnvironmentOptions,
  +meta?: Meta,
  +pipeline?: string,
  +resolveFrom?: FilePath,
  +target?: Target,
  +symbols?: $ReadOnlyMap<
    Symbol,
    {|local: Symbol, loc: ?SourceLocation, isWeak: boolean|},
  >,
|};

/**
 * A Dependency denotes a connection between two assets \
 * (likely some effect from the importee is expected - be it a side effect or a value is being imported).
 *
 * @section transformer
 */
export interface Dependency {
  +id: string;
  /** E.g. "lodash" in <code>import {add} from "lodash";</code>  */
  +moduleSpecifier: ModuleSpecifier;
  +isAsync: boolean;
  /** Whether this should become a entry in a bundle. */
  +isEntry: ?boolean;
  /** Whether a failed resolution should not cause a build error. */
  +isOptional: boolean;
  /** Whether an URL is expected (rather than the language-specific behaviour). */
  +isURL: boolean;
  +isIsolated: boolean;
  /** Used for error messages, the code location that caused this dependency. */
  +loc: ?SourceLocation;
  +env: Environment;
  +meta: Meta;
  +target: ?Target;
  /** Used for error messages, the importer. */
  +sourceAssetId: ?string;
  /** Used for error messages, the importer. */
  +sourcePath: ?string;
  +resolveFrom: ?string;
  /** a named pipeline (if the <code>moduleSpecifier</code> didn't specify one). */
  +pipeline: ?string;

  // TODO make immutable
  /** a <code>Map&lt;export name of importee, placeholder in importer&gt;</code>. */
  +symbols: MutableDependencySymbols;
}

export type File = {|
  +filePath: FilePath,
  +hash?: string,
|};

/**
 * @section transformer
 */
export type ASTGenerator = {|
  type: string,
  version: string,
|};

/**
 * An asset (usually represents one source file).
 *
 * @section transformer
 */
export interface BaseAsset {
  +env: Environment;
  /** The file system where the source is located. */
  +fs: FileSystem;
  +filePath: FilePath;
  +query: QueryParameters;
  +id: string;
  +meta: Meta;
  +isIsolated: boolean;
  /** Whether this asset will/should later be inserted back into the importer. */
  +isInline: boolean;
  +isSplittable: ?boolean;
  /** Whether this is asset is part of the users project (and not of an external dependencies) and should be transpiled. */
  +isSource: boolean;
  /** Usually corresponds to the file extension */
  +type: string;
  /** Whether this asset can be omitted if none of its exports are being used (set by ResolveResult) */
  +sideEffects: boolean;
  /**
   * Inline assets inheirit the parent's <code>id</code>, making it not be enough for a unique identification
   * (this could be a counter that is unique per asset)
   */
  +uniqueKey: ?string;
  /** The type of the AST. */
  +astGenerator: ?ASTGenerator;
  +pipeline: ?string;

  /** a <code>Map&lt;export name, name of binding&gt;</code> */
  +symbols: AssetSymbols;

  /** Returns to current AST. See notes in subclasses (Asset, MutableAsset).*/
  getAST(): Promise<?AST>;
  /** Returns to current source code. See notes in MutableAsset. */
  getCode(): Promise<string>;
  /** Returns the contents as a buffer. */
  getBuffer(): Promise<Buffer>;
  /** Returns the contents as a stream. */
  getStream(): Readable;
  /** Returns the sourcemap (if existent). */
  getMap(): Promise<?SourceMap>;
  /** A buffer representation of the sourcemap (if existent). */
  getMapBuffer(): Promise<?Buffer>;
  getDependencies(): $ReadOnlyArray<Dependency>;
  /** Used to load config files, (looks in every parent folder until a module root) \
   * for the specified filenames. <code>packageKey</code> can be used to also check <code>pkg#[packageKey]</code>.
   */
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
    |},
  ): Promise<ConfigResult | null>;
  /** Returns the package.json this file belongs to. */
  getPackage(): Promise<PackageJSON | null>;
}

/**
 * A somewhat modifiable version of BaseAsset (for transformers)
 * @section transformer
 */
export interface MutableAsset extends BaseAsset {
  isIsolated: boolean;
  isInline: boolean;
  isSplittable: ?boolean;
  type: string;

  addDependency(dep: DependencyOptions): string;
  addIncludedFile(filePath: FilePath): void;
  invalidateOnFileCreate(invalidation: FileCreateInvalidation): void;
  addURLDependency(url: string, opts: $Shape<DependencyOptions>): string;
  invalidateOnEnvChange(env: string): void;

  +symbols: MutableAssetSymbols;

  isASTDirty(): boolean;
  getAST(): Promise<?AST>;
  setAST(AST): void;
  setBuffer(Buffer): void;
  setCode(string): void;
  /** Throws if the AST is dirty (meaning: this won't implicity stringify the AST). */
  getCode(): Promise<string>;
  setEnvironment(opts: EnvironmentOptions): void;
  setMap(?SourceMap): void;
  setStream(Readable): void;
}

/**
 * @section transformer
 */
export interface Asset extends BaseAsset {
  +stats: Stats;
}

export type DevDepOptions = {|
  moduleSpecifier: ModuleSpecifier,
  resolveFrom: FilePath,
  /**
   * Whether to also invalidate the parcel plugin that loaded this dev dependency
   * when it changes. This is useful if the parcel plugin or another parent dependency
   * has its own cache for this dev dependency other than Node's require cache.
   */
  invalidateParcelPlugin?: boolean,
|};

/**
 * @section transformer
 */
export interface Config {
  +isSource: boolean;
  +searchPath: FilePath;
  +result: ConfigResult;
  +env: Environment;
  +includedFiles: Set<FilePath>;

  setResult(result: ConfigResult): void; // TODO: fix
  setResultHash(resultHash: string): void;
  addIncludedFile(filePath: FilePath): void;
  addDevDependency(devDep: DevDepOptions): void;
  invalidateOnFileCreate(invalidation: FileCreateInvalidation): void;
  getConfigFrom(
    searchPath: FilePath,
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResultWithFilePath | null>;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResultWithFilePath | null>;
  getPackage(): Promise<PackageJSON | null>;
  shouldInvalidateOnStartup(): void;
}

export type Stats = {|
  time: number,
  size: number,
|};

/**
 * @section transformer
 */
export type GenerateOutput = {|
  +content: Blob,
  +map?: ?SourceMap,
|};

export type Blob = string | Buffer | Readable;

/**
 * Will be used to generate a new BaseAsset, see that.
 * @section transformer
 */
export type TransformerResult = {|
  +ast?: ?AST,
  +content?: ?Blob,
  +dependencies?: $ReadOnlyArray<DependencyOptions>,
  +env?: EnvironmentOptions,
  +filePath?: FilePath,
  +query?: ?QueryParameters,
  +includedFiles?: $ReadOnlyArray<File>,
  +isInline?: boolean,
  +isIsolated?: boolean,
  +isSource?: boolean,
  +isSplittable?: boolean,
  +map?: ?SourceMap,
  +meta?: Meta,
  +pipeline?: ?string,
  +sideEffects?: boolean,
  +symbols?: $ReadOnlyMap<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
  +type: string,
  +uniqueKey?: ?string,
|};

export type Async<T> = T | Promise<T>;

/**
 * @section transformer
 */
export type ResolveFn = (from: FilePath, to: string) => Promise<FilePath>;

/**
 * @section validator
 */
type ResolveConfigFn = (configNames: Array<FilePath>) => Promise<?FilePath>;

/**
 * @section validator
 */
type ResolveConfigWithPathFn = (
  configNames: Array<FilePath>,
  assetFilePath: string,
) => Promise<?FilePath>;

/**
 * @section validator
 */
export type ValidateResult = {|
  warnings: Array<Diagnostic>,
  errors: Array<Diagnostic>,
|};

/**
 * @section validator
 */
export type DedicatedThreadValidator = {|
  validateAll: ({|
    assets: Asset[],
    resolveConfigWithPath: ResolveConfigWithPathFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<Array<?ValidateResult>>,
|};

/**
 * @section validator
 */
export type MultiThreadValidator = {|
  validate: ({|
    asset: Asset,
    config: ConfigResult | void,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<ValidateResult | void>,
  getConfig?: ({|
    asset: Asset,
    resolveConfig: ResolveConfigFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<ConfigResult | void>,
|};

/**
 * @section validator
 */
export type Validator = DedicatedThreadValidator | MultiThreadValidator;

/**
 * The methods for a transformer plugin.
 * @section transformer
 */
export type Transformer = {|
  loadConfig?: ({|
    config: Config,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<void>,
  /** Whether an AST from a previous transformer can be reused (to prevent double-parsing) */
  canReuseAST?: ({|
    ast: AST,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => boolean,
  /** Parse the contents into an ast */
  parse?: ({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<?AST>,
  /** Transform the asset and/or add new assets */
  transform({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<Array<TransformerResult | MutableAsset>>,
  /** Stringify the AST */
  generate?: ({|
    asset: Asset,
    ast: AST,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<GenerateOutput>,
|};

/**
 * Used to control a traversal
 * @section bundler
 */
export interface TraversalActions {
  /** Skip the current node's children and continue the traversal if there are other nodes in the queue. */
  skipChildren(): void;
  /** Stop the traversal */
  stop(): void;
}

/**
 * Essentially GraphTraversalCallback, but allows adding specific node enter and exit callbacks.
 * @section bundler
 */
export type GraphVisitor<TNode, TContext> =
  | GraphTraversalCallback<TNode, TContext>
  | {|
      enter?: GraphTraversalCallback<TNode, TContext>,
      exit?: GraphTraversalCallback<TNode, TContext>,
    |};

/**
 * A generic callback for graph traversals
 * @param context The parent node's return value is passed as a parameter to the children's callback. \
 * This can be used to forward information from the parent to children in a DFS (unlike a global variable).
 * @section bundler
 */
export type GraphTraversalCallback<TNode, TContext> = (
  node: TNode,
  context: ?TContext,
  actions: TraversalActions,
) => ?TContext;

/**
 * @section bundler
 */
export type BundleTraversable =
  | {|+type: 'asset', value: Asset|}
  | {|+type: 'dependency', value: Dependency|};

/**
 * @section bundler
 */
export type BundlerBundleGraphTraversable =
  | {|+type: 'asset', value: Asset|}
  | {|+type: 'dependency', value: Dependency|};

/**
 * Options for MutableBundleGraph's <code>createBundle</code>.
 *
 * If an <code>entryAsset</code> is provided, <code>uniqueKey</code> (for the bundle id),
 * <code>type</code>, and <code>env</code> will be inferred from the <code>entryAsset</code>.
 *
 * If an <code>entryAsset</code> is not provided, <code>uniqueKey</code> (for the bundle id),
 * <code>type</code>, and <code>env</code> must be provided.
 *
 * isSplittable defaults to <code>entryAsset.isSplittable</code> or <code>false</code>
 * @section bundler
 */
export type CreateBundleOpts =
  // If an entryAsset is provided, a bundle id, type, and environment will be
  // inferred from the entryAsset.
  | {|
      +uniqueKey?: string,
      +entryAsset: Asset,
      +target: Target,
      +isEntry?: ?boolean,
      +isInline?: ?boolean,
      +isSplittable?: ?boolean,
      +type?: ?string,
      +env?: ?Environment,
      +pipeline?: ?string,
    |}
  // If an entryAsset is not provided, a bundle id, type, and environment must
  // be provided.
  | {|
      +uniqueKey: string,
      +entryAsset?: Asset,
      +target: Target,
      +isEntry?: ?boolean,
      +isInline?: ?boolean,
      +isSplittable?: ?boolean,
      +type: string,
      +env: Environment,
      +pipeline?: ?string,
    |};

/**
 * Specifies a symbol in an asset
 * @section packager
 */
export type SymbolResolution = {|
  /** The Asset which exports the symbol. */
  +asset: Asset,
  /** under which name the symbol is exported */
  +exportSymbol: Symbol | string,
  /** The identifier under which the symbol can be referenced. */
  +symbol: void | null | false | Symbol,
  /** The location of the specifier that lead to this result. */
  +loc: ?SourceLocation,
|};

/**
 * @section packager
 */
export type ExportSymbolResolution = {|
  ...SymbolResolution,
  +exportAs: Symbol | string,
|};

/**
 * A Bundle (a collection of assets)
 *
 * @section bundler
 */
export interface Bundle {
  +id: string;
  /** Whether this value is inside <code>filePath</code> it will be replace with the real hash at the end. */
  +hashReference: string;
  +type: string;
  +env: Environment;
  /** The output filespath (if not inline), can contain <code>hashReference</code> before the optimizer ran. */
  +filePath: ?FilePath;
  /** Whether this is an entry (e.g. should not be hashed). */
  +isEntry: ?boolean;
  /** Whether this bundle should be inlined into the parent bundle(s), */
  +isInline: ?boolean;
  +isSplittable: ?boolean;
  +target: Target;
  +stats: Stats;
  /** Assets that run when the bundle is loaded (e.g. runtimes could be added). VERIFY */
  getEntryAssets(): Array<Asset>;
  /** The actual entry (which won't be a runtime). */
  getMainEntry(): ?Asset;
  hasAsset(Asset): boolean;
  hasDependency(Dependency): boolean;
  /** Traverses the assets in the bundle. */
  traverseAssets<TContext>(visit: GraphVisitor<Asset, TContext>): ?TContext;
  /** Traverses assets and dependencies (see BundleTraversable). */
  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>,
  ): ?TContext;
}

/**
 * A Bundle that got named by a Namer
 * @section bundler
 */
export interface NamedBundle extends Bundle {
  +publicId: string;
  +filePath: FilePath;
  +name: string;
  +displayName: string;
}

/**
 * A collection of sibling bundles (which are stored in the BundleGraph) that should be loaded together (in order).
 * @section bundler
 */
export type BundleGroup = {|
  +target: Target,
  +entryAssetId: string,
|};

/**
 * A BundleGraph in the Bundler that can be modified
 * @section bundler
 */
export interface MutableBundleGraph extends BundleGraph<Bundle> {
  /** Add asset and all child nodes to the bundle. */
  addAssetGraphToBundle(
    Asset,
    Bundle,
    shouldSkipDependency?: (Dependency) => boolean,
  ): void;
  addEntryToBundle(
    Asset,
    Bundle,
    shouldSkipDependency?: (Dependency) => boolean,
  ): void;
  addBundleToBundleGroup(Bundle, BundleGroup): void;
  createAssetReference(Dependency, Asset, Bundle): void;
  createBundleReference(Bundle, Bundle): void;
  createBundle(CreateBundleOpts): Bundle;
  /** Turns an edge (Dependency -> Asset-s) into (Dependency -> BundleGroup -> Asset-s) */
  createBundleGroup(Dependency, Target): BundleGroup;
  getDependencyAssets(Dependency): Array<Asset>;
  getParentBundlesOfBundleGroup(BundleGroup): Array<Bundle>;
  getTotalSize(Asset): number;
  /** Remove all "contains" edges from the bundle to the nodes in the asset's subgraph. */
  removeAssetGraphFromBundle(Asset, Bundle): void;
  removeBundleGroup(bundleGroup: BundleGroup): void;
  /** Turns a dependency to a different bundle into a dependency to an asset inside <code>bundle</code>. */
  internalizeAsyncDependency(bundle: Bundle, dependency: Dependency): void;
  traverse<TContext>(
    GraphVisitor<BundlerBundleGraphTraversable, TContext>,
  ): ?TContext;
  traverseContents<TContext>(
    GraphVisitor<BundlerBundleGraphTraversable, TContext>,
  ): ?TContext;
}

/**
 * A Graph that contains Bundle-s, Asset-s, Dependency-s, BundleGroup-s
 * @section bundler
 */
export interface BundleGraph<TBundle: Bundle> {
  getAssetById(id: string): Asset;
  getAssetPublicId(asset: Asset): string;
  getBundles(): Array<TBundle>;
  getBundleGroupsContainingBundle(bundle: Bundle): Array<BundleGroup>;
  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<TBundle>;
  /** Child bundles are Bundles that might be loaded by an asset in the bundle */
  getChildBundles(bundle: Bundle): Array<TBundle>;
  getParentBundles(bundle: Bundle): Array<TBundle>;
  /** Bundles that are referenced (by filename) */
  getReferencedBundles(
    bundle: Bundle,
    opts?: {|recursive: boolean|},
  ): Array<TBundle>;
  /** Get the dependencies that the asset requires */
  getDependencies(asset: Asset): Array<Dependency>;
  /** Get the dependencies that require the asset */
  getIncomingDependencies(asset: Asset): Array<Dependency>;
  /** Get the asset that created the dependency. */
  getAssetWithDependency(dep: Dependency): ?Asset;
  isEntryBundleGroup(bundleGroup: BundleGroup): boolean;
  /**
   * Returns undefined if the specified dependency was excluded or wasn't async \
   * and otherwise the BundleGroup or Asset that the dependency resolves to.
   */
  resolveAsyncDependency(
    dependency: Dependency,
    bundle: ?Bundle,
  ): ?(
    | {|type: 'bundle_group', value: BundleGroup|}
    | {|type: 'asset', value: Asset|}
  );
  /** If a dependency was excluded since it's unused based on symbol data. */
  isDependencySkipped(dependency: Dependency): boolean;
  /** Find out which asset the dependency resolved to. */
  getDependencyResolution(dependency: Dependency, bundle: ?Bundle): ?Asset;
  getReferencedBundle(dependency: Dependency, bundle: Bundle): ?TBundle;
  findBundlesWithAsset(Asset): Array<TBundle>;
  findBundlesWithDependency(Dependency): Array<TBundle>;
  /** Whether the asset is already included in a compatible (regarding EnvironmentContext) parent bundle. */
  isAssetReachableFromBundle(asset: Asset, bundle: Bundle): boolean;
  findReachableBundleWithAsset(bundle: Bundle, asset: Asset): ?TBundle;
  isAssetReferencedByDependant(bundle: Bundle, asset: Asset): boolean;
  hasParentBundleOfType(bundle: Bundle, type: string): boolean;
  /**
   * Resolve the export `symbol` of `asset` to the source,
   * stopping at the first asset after leaving `bundle`.
   * `symbol === null`: bailout (== caller should do `asset.exports[exportsSymbol]`)
   * `symbol === undefined`: symbol not found
   * `symbol === false`: skipped
   *
   * <code>asset</code> exports <code>symbol</code>, try to find the asset where the \
   * corresponding variable lives (resolves re-exports). Stop resolving transitively once \
   * <code>boundary</code> was left (<code>bundle.hasAsset(asset) === false</code>), then <code>result.symbol</code> is undefined.
   */
  resolveSymbol(
    asset: Asset,
    symbol: Symbol,
    boundary: ?Bundle,
  ): SymbolResolution;
  /** Gets the symbols that are (transivitely) exported by the asset */
  getExportedSymbols(
    asset: Asset,
    boundary: ?Bundle,
  ): Array<ExportSymbolResolution>;
  traverseBundles<TContext>(
    visit: GraphVisitor<TBundle, TContext>,
    startBundle: ?Bundle,
  ): ?TContext;
  getUsedSymbols(Asset | Dependency): $ReadOnlySet<Symbol>;
}

/**
 * @section bundler
 */
export type BundleResult = {|
  +contents: Blob,
  +ast?: AST,
  +map?: ?SourceMap,
  +type?: string,
|};

export type GlobInvalidation = {|
  glob: Glob,
|};

export type FileInvalidation = {|
  filePath: FilePath,
|};

export type FileAboveInvalidation = {|
  fileName: string,
  aboveFilePath: FilePath,
|};

export type FileCreateInvalidation =
  | FileInvalidation
  | GlobInvalidation
  | FileAboveInvalidation;

/**
 * @section resolver
 */
export type ResolveResult = {|
  +filePath?: FilePath,
  +isExcluded?: boolean,
  /** Corresponds to BaseAsset's <code>sideEffects</code>. */
  +sideEffects?: boolean,
  /** A resolver might want to resolve to a dummy, in this case <code>filePath</code> is rather "resolve from". */
  +code?: string,
  /** Whether this dependency can be deferred by Parcel itself (true by default). */
  +canDefer?: boolean,
  /** A resolver might return diagnostics to also run subsequent resolvers while still providing a reason why it failed. */
  +diagnostics?: Diagnostic | Array<Diagnostic>,
  /** Is spread (shallowly merged) onto the request's dependency.meta */
  +meta?: JSONObject,
  +invalidateOnFileCreate?: Array<FileCreateInvalidation>,
  +invalidateOnFileChange?: Array<FilePath>,
|};

export type ConfigOutput = {|
  config: ConfigResult,
  files: Array<File>,
|};

/**
 * Turns an asset graph into a BundleGraph.
 *
 * bundle and optimize run in series and are functionally identitical.
 * @section bundler
 */
export type Bundler = {|
  loadConfig?: ({|
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<ConfigOutput>,
  bundle({|
    bundleGraph: MutableBundleGraph,
    config: ?ConfigResult,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void>,
  optimize({|
    bundleGraph: MutableBundleGraph,
    config: ?ConfigResult,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void>,
|};

/**
 * @section namer
 */
export type Namer = {|
  /** Return a filename/-path for <code>bundle</code> or nullish to leave it to the next namer plugin. */
  name({|
    bundle: Bundle,
    bundleGraph: BundleGraph<Bundle>,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<?FilePath>,
|};

/**
 * A "synthetic" asset that will be inserted into the bundle graph.
 * @section runtime
 */
export type RuntimeAsset = {|
  +filePath: FilePath,
  +code: string,
  +dependency?: Dependency,
  +isEntry?: boolean,
|};

/**
 * @section runtime
 */
export type Runtime = {|
  apply({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void | RuntimeAsset | Array<RuntimeAsset>>,
|};

/**
 * @section packager
 */
export type Packager = {|
  loadConfig?: ({|
    bundle: NamedBundle,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<?ConfigOutput>,
  package({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
    options: PluginOptions,
    logger: PluginLogger,
    config: ?ConfigResult,
    getInlineBundleContents: (
      Bundle,
      BundleGraph<NamedBundle>,
    ) => Async<{|contents: Blob|}>,
    getSourceMapReference: (map: ?SourceMap) => Async<?string>,
  |}): Async<BundleResult>,
|};

/**
 * @section optimizer
 */
export type Optimizer = {|
  optimize({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
    contents: Blob,
    map: ?SourceMap,
    options: PluginOptions,
    logger: PluginLogger,
    getSourceMapReference: (map: ?SourceMap) => Async<?string>,
  |}): Async<BundleResult>,
|};

/**
 * @section resolver
 */
export type Resolver = {|
  resolve({|
    dependency: Dependency,
    options: PluginOptions,
    logger: PluginLogger,
    filePath: FilePath,
  |}): Async<?ResolveResult>,
|};

/**
 * @section reporter
 */
export type ProgressLogEvent = {|
  +type: 'log',
  +level: 'progress',
  +phase?: string,
  +message: string,
|};

/**
 * A log event with a rich diagnostic
 * @section reporter
 */
export type DiagnosticLogEvent = {|
  +type: 'log',
  +level: 'error' | 'warn' | 'info' | 'verbose',
  +diagnostics: Array<Diagnostic>,
|};

/**
 * @section reporter
 */
export type TextLogEvent = {|
  +type: 'log',
  +level: 'success',
  +message: string,
|};

/**
 * @section reporter
 */
export type LogEvent = ProgressLogEvent | DiagnosticLogEvent | TextLogEvent;

/**
 * The build just started.
 * @section reporter
 */
export type BuildStartEvent = {|
  +type: 'buildStart',
|};

/**
 * The build just started in watch mode.
 * @section reporter
 */
export type WatchStartEvent = {|
  +type: 'watchStart',
|};

/**
 * The build just ended in watch mode.
 * @section reporter
 */
export type WatchEndEvent = {|
  +type: 'watchEnd',
|};

/**
 * A new Dependency is being resolved.
 * @section reporter
 */
export type ResolvingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'resolving',
  +dependency: Dependency,
|};

/**
 * A new Asset is being transformed.
 * @section reporter
 */
export type TransformingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'transforming',
  +filePath: FilePath,
|};

/**
 * The BundleGraph is generated.
 * @section reporter
 */
export type BundlingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'bundling',
|};

/**
 * A new Bundle is being packaged.
 * @section reporter
 */
export type PackagingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'packaging',
  +bundle: NamedBundle,
|};

/**
 * A new Bundle is being optimized.
 * @section reporter
 */
export type OptimizingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'optimizing',
  +bundle: NamedBundle,
|};

/**
 * @section reporter
 */
export type BuildProgressEvent =
  | ResolvingProgressEvent
  | TransformingProgressEvent
  | BundlingProgressEvent
  | PackagingProgressEvent
  | OptimizingProgressEvent;

/**
 * The build was successful.
 * @section reporter
 */
export type BuildSuccessEvent = {|
  +type: 'buildSuccess',
  +bundleGraph: BundleGraph<NamedBundle>,
  +buildTime: number,
  +changedAssets: Map<string, Asset>,
  +requestBundle: (bundle: NamedBundle) => Promise<BuildSuccessEvent>,
|};

/**
 * The build failed.
 * @section reporter
 */
export type BuildFailureEvent = {|
  +type: 'buildFailure',
  +diagnostics: Array<Diagnostic>,
|};

/**
 * @section reporter
 */
export type BuildEvent = BuildFailureEvent | BuildSuccessEvent;

/**
 * A new file is being validated.
 * @section reporter
 */
export type ValidationEvent = {|
  +type: 'validation',
  +filePath: FilePath,
|};

/**
 * @section reporter
 */
export type ReporterEvent =
  | LogEvent
  | BuildStartEvent
  | BuildProgressEvent
  | BuildSuccessEvent
  | BuildFailureEvent
  | WatchStartEvent
  | WatchEndEvent
  | ValidationEvent;

/**
 * @section reporter
 */
export type Reporter = {|
  report({|
    event: ReporterEvent,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void>,
|};

export interface ErrorWithCode extends Error {
  +code?: string;
}

export interface IDisposable {
  dispose(): mixed;
}

export interface AsyncSubscription {
  unsubscribe(): Promise<mixed>;
}
