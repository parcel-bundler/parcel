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
/** Plugin-specific config result, <code>any</code> */
export type ConfigResult = _ConfigResult;
/** <code>process.env</code> */
export type EnvMap = typeof process.env;

/** A JSON value */
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

export type GlobMap<T> = {[Glob]: T, ...};

/** A pipeline as specified in the config -> T  */
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
 * @property distEntry The output filename of the entry
 * @property distDir The output folder
 * @property loc The location that created this Target
 */
export interface Target {
  +distEntry: ?FilePath;
  +distDir: FilePath;
  +env: Environment;
  +sourceMap: ?TargetSourceMapOptions;
  +name: string;
  +publicUrl: string;
  +loc: ?SourceLocation;
}

/** In which environment the output should run (influces e.g. loaders) */
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
  +minify?: boolean,
  +scopeHoist?: boolean,
|};

/**
 * The target format when using the JS API.
 *
 * (Same as PackageTargetDescriptor, but <code>distDir</code> is required.)
 */
export type TargetDescriptor = {|
  ...PackageTargetDescriptor,
  +distDir: FilePath,
|};

/**
 * This is used when creating an Environment (see that).
 */
export type EnvironmentOpts = {|
  +context?: EnvironmentContext,
  +engines?: Engines,
  +includeNodeModules?:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...},
  +outputFormat?: OutputFormat,
  +isLibrary?: boolean,
  +minify?: boolean,
  +scopeHoist?: boolean,
|};

/**
 * Example:
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
 * @property includeNodeModules Whether to include all/none packages \
 *  (<code>true / false</code>), an array of package names to include, or an object \
 *  (of a package is not specified, it's included).
 * @property isLibrary Whether this is a library build (e.g. less loaders)
 * @property minify Whether the output should be minified.
 * @property scopeHoist Whether scope hoisting is enabled.
 * @method isBrowser Whether <code>context</code> specifies a browser context
 * @method isNode Whether <code>context</code> specifies a node context
 * @method isElectron Whether <code>context</code> specifies an electron context
 * @method isWorker Whether <code>context</code> specifies a worker context
 * @method isIsolated Whether <code>context</code> specifies an isolated context (can't access other loaded ancestor bundles).
 */
export interface Environment {
  +context: EnvironmentContext;
  +engines: Engines;
  +includeNodeModules:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...};
  +outputFormat: OutputFormat;
  +isLibrary: boolean;
  +minify: boolean;
  +scopeHoist: boolean;

  isBrowser(): boolean;
  isNode(): boolean;
  isElectron(): boolean;
  isWorker(): boolean;
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
  source?: FilePath | {[FilePath]: FilePath, ...},
  alias?: {[PackageName | FilePath | Glob]: PackageName | FilePath, ...},
  browserslist?: Array<string>,
  engines?: Engines,
  targets?: {[string]: PackageTargetDescriptor, ...},
  dependencies?: PackageDependencies,
  devDependencies?: PackageDependencies,
  peerDependencies?: PackageDependencies,
  sideEffects?: boolean | FilePath | Array<FilePath>,
  ...
};

export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'verbose';
export type BuildMode = 'development' | 'production' | string;

export type InitialParcelOptions = {|
  +entries?: FilePath | Array<FilePath>,
  +rootDir?: FilePath,
  +config?: ResolvedParcelConfigFile,
  +defaultConfig?: ResolvedParcelConfigFile,
  +env?: EnvMap,
  +targets?: ?(Array<string> | {+[string]: TargetDescriptor, ...}),

  +disableCache?: boolean,
  +cacheDir?: FilePath,
  +killWorkers?: boolean,
  +mode?: BuildMode,
  +minify?: boolean,
  +scopeHoist?: boolean,
  +sourceMaps?: boolean,
  +publicUrl?: string,
  +distDir?: FilePath,
  +hot?: ?HMROptions,
  +serve?: ServerOptions | false,
  +autoinstall?: boolean,
  +logLevel?: LogLevel,
  +profile?: boolean,
  +patchConsole?: boolean,

  +inputFS?: FileSystem,
  +outputFS?: FileSystem,
  +workerFarm?: WorkerFarm,
  +packageManager?: PackageManager,
  +defaultEngines?: Engines,
  +detailedReport?: number | boolean,

  // contentHash
  // throwErrors
  // global?
|};

export interface PluginOptions {
  +mode: BuildMode;
  +sourceMaps: boolean;
  +env: EnvMap;
  +hot: ?HMROptions;
  +serve: ServerOptions | false;
  +autoinstall: boolean;
  +logLevel: LogLevel;
  +rootDir: FilePath;
  +distDir: FilePath;
  +projectRoot: FilePath;
  +cacheDir: FilePath;
  +inputFS: FileSystem;
  +outputFS: FileSystem;
  +packageManager: PackageManager;
  +instanceId: string;
  +detailedReport: number;
}

export type ServerOptions = {|
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
 * @property start inclusive
 * @property end exclusive, FIXME?
 */
export type SourceLocation = {|
  +filePath: string,
  +start: {|
    +line: number,
    +column: number,
  |},
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
export type CodeSymbol = string;
export interface CodeSymbols // eslint-disable-next-line no-undef
  extends Iterable<[CodeSymbol, {|local: CodeSymbol, loc: ?SourceLocation|}]> {
  get(exportSymbol: CodeSymbol): ?{|local: CodeSymbol, loc: ?SourceLocation|};
  hasExportSymbol(exportSymbol: CodeSymbol): boolean;
  hasLocalSymbol(local: CodeSymbol): boolean;
  // Whether static analysis bailed out
  +isCleared: boolean;
}
export interface MutableCodeSymbols extends CodeSymbols {
  // Static analysis bailed out
  clear(): void;
  set(exportSymbol: CodeSymbol, local: CodeSymbol, loc: ?SourceLocation): void;
}

/**
 * Usen when creating a Dependency, see that.
 * @property env Is merged with the environment of the importer.
 * @property target FIXME why can this overwritten? cross-target?
 */
export type DependencyOptions = {|
  +moduleSpecifier: ModuleSpecifier,
  +isAsync?: boolean,
  +isEntry?: boolean,
  +isOptional?: boolean,
  +isURL?: boolean,
  +isWeak?: ?boolean,
  +loc?: SourceLocation,
  +env?: EnvironmentOpts,
  +meta?: Meta,
  +target?: Target,
  +symbols?: $ReadOnlyMap<
    CodeSymbol,
    {|local: CodeSymbol, loc: ?SourceLocation|},
  >,
|};

/**
 * A Dependency denotes a connection between two assets \
 * (likely some effect from the importee is expected - be it a side effect or a value is being imported).
 *
 * @property moduleSpecifier E.g. "lodash" in <code>import {add} from "lodash";</code>
 * @property isAsync Whether the environment can load this natively (FIXME).
 * @property isEntry Whether this should become a new entry (e.g. no hash).
 * @property isOptional Whether the importer might expect an error when resolving failed.
 * @property isURL Whether an URL is expected (rather than the language-specific behaviour).
 * @property isWeak Whether this dependency does not provide any values for the importer itself.
 * @property isDeferred Whether this dependency was never resolved because it was deemed unnecessary/unused (based on symbols).
 * @property loc Used for error messages, the code location that caused this dependency.
 * @property env the environment of the importee.
 * @property target FIXME importer or importee?
 * @property sourceAssetId used for error messages, the importer.
 * @property sourcePath used for error messages, the importer.
 * @property symbols a <code>Map&lt;export name of importee, placeholder in importer&gt;</code>.
 * @property pipeline a named pipeline to be chosen (if the <code>moduleSpecifier</code> didn't specify one).
 */
export interface Dependency {
  +id: string;
  +moduleSpecifier: ModuleSpecifier;
  +isAsync: boolean;
  +isEntry: boolean;
  +isOptional: boolean;
  +isURL: boolean;
  +isWeak: ?boolean;
  +loc: ?SourceLocation;
  +env: Environment;
  +meta: Meta;
  +target: ?Target;
  +sourceAssetId: ?string;
  +sourcePath: ?string;
  +pipeline: ?string;

  // (imported symbol -> variable that it is used as)
  // TODO make immutable
  +symbols: MutableCodeSymbols;
}

export type File = {|
  +filePath: FilePath,
  +hash?: string,
|};

export type ASTGenerator = {|
  type: string,
  version: string,
|};

/**
 * An asset (usually represents one source file).
 *
 * @property The file system where the source is located.
 * @property isIsolated Whether this asset should be put in a separate bundle. VERIFY
 * @property isInline Whether this asset will/should later be inserted back into the importer.
 * @property isSplittable FIXME
 * @property isSource Whether this is asset is part of the users project (and not of an external dependencies).
 * @property type Usually corresponds to the file extension
 * @property symbols a <code>Map&lt;export name, identifier name;</code>
 * @property sideEffects Whether this asset can be omitted if none if it's exports are being used (set by ResolveResult)
 * @property uniqueKey In an inline asset, <code>id</code> might not be enough for a unique identification. FIXME
 * @property astGenerator The type of the AST.
 *
 * @method getAST Returns to current AST. See notes in subclasses (Asset, MutableAsset).
 * @method getCode Returns to current source code. See notes in MutableAsset.
 * @method getBuffer Returns the contents as a buffer.
 * @method getStream Returns the contents as a stream.
 * @method getMap Returns the sourcemap (if existent).
 * @method getMapBuffer A buffer representation of the sourcemap (if existent).
 * @method getConfig Used to load config files, (looks in every parent folder until a module root) \
 * for the specified filenames. <code>packageKey</code> can be used to also check <code>pkg#[packageKey]</code>.
 * @method getPackage Returns the package.json this file belongs to.
 */
export interface BaseAsset {
  +env: Environment;
  +fs: FileSystem;
  +filePath: FilePath;
  +id: string;
  +meta: Meta;
  +isIsolated: boolean;
  +isInline: boolean;
  +isSplittable: ?boolean;
  +isSource: boolean;
  +type: string;
  +sideEffects: boolean;
  +uniqueKey: ?string;
  +astGenerator: ?ASTGenerator;

  // (symbol exported by this -> name of binding to export)
  +symbols: CodeSymbols;

  getAST(): Promise<?AST>;
  getCode(): Promise<string>;
  getBuffer(): Promise<Buffer>;
  getStream(): Readable;
  getMap(): Promise<?SourceMap>;
  getMapBuffer(): Promise<?Buffer>;
  getIncludedFiles(): $ReadOnlyArray<File>;
  getDependencies(): $ReadOnlyArray<Dependency>;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
    |},
  ): Promise<ConfigResult | null>;
  getPackage(): Promise<PackageJSON | null>;
}

/**
 * A somewhat modifiable version of BaseAsset (for transformers)
 * @method getAST Returns <code>null</code> if there is no AST.
 * @method getCode Throws if the AST is dirty (meaning: this won't implicity stringify the AST).
 */
export interface MutableAsset extends BaseAsset {
  isIsolated: boolean;
  isInline: boolean;
  isSplittable: ?boolean;
  type: string;

  addDependency(dep: DependencyOptions): string;
  addIncludedFile(file: File): void;
  addURLDependency(url: string, opts: $Shape<DependencyOptions>): string;

  +symbols: MutableCodeSymbols;

  isASTDirty(): boolean;
  setAST(AST): void;
  setBuffer(Buffer): void;
  setCode(string): void;
  setEnvironment(opts: EnvironmentOpts): void;
  setMap(?SourceMap): void;
  setStream(Readable): void;
}

/**
 * @method getAST Throws if there is no AST.
 */
export interface Asset extends BaseAsset {
  +stats: Stats;
}

/**
 * FIXME
 *
 * @property isSource
 * @property searchPath
 * @property result
 * @property resolvedPath
 *
 * @method setResolvedPath FIXME
 * @method setResult FIXME
 * @method setResultHash FIXME
 * @method addIncludedFile FIXME
 * @method addDevDependency FIXME
 * @method setWatchGlob FIXME
 * @method getConfigFrom FIXME
 * @method getConfig FIXME
 * @method getPackage FIXME
 * @method shouldRehydrate FIXME
 * @method shouldReload FIXME
 * @method shouldInvalidateOnStartup FIXME
 */
export interface Config {
  +isSource: boolean;
  +searchPath: FilePath;
  +result: ConfigResult;
  +env: Environment;
  +resolvedPath: ?FilePath;

  setResolvedPath(filePath: FilePath): void;
  setResult(result: ConfigResult): void; // TODO: fix
  setResultHash(resultHash: string): void;
  addIncludedFile(filePath: FilePath): void;
  addDevDependency(name: PackageName, version?: Semver): void;
  setWatchGlob(glob: string): void;
  getConfigFrom(
    searchPath: FilePath,
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResult | null>;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResult | null>;
  getPackage(): Promise<PackageJSON | null>;
  shouldRehydrate(): void;
  shouldReload(): void;
  shouldInvalidateOnStartup(): void;
}

export type Stats = {|
  time: number,
  size: number,
|};

export type GenerateOutput = {|
  +content: Blob,
  +map?: ?SourceMap,
|};

export type Blob = string | Buffer | Readable;

/**
 * Will be used to generate a new BaseAsset, see that.
 */
export type TransformerResult = {|
  +ast?: ?AST,
  +content?: ?Blob,
  +dependencies?: $ReadOnlyArray<DependencyOptions>,
  +env?: EnvironmentOpts,
  +filePath?: FilePath,
  +includedFiles?: $ReadOnlyArray<File>,
  +isInline?: boolean,
  +isIsolated?: boolean,
  +isSource?: boolean,
  +isSplittable?: boolean,
  +map?: ?SourceMap,
  +meta?: Meta,
  +pipeline?: ?string,
  +sideEffects?: boolean,
  +symbols?: $ReadOnlyMap<
    CodeSymbol,
    {|local: CodeSymbol, loc: ?SourceLocation|},
  >,
  +symbolsConfident?: boolean,
  +type: string,
  +uniqueKey?: ?string,
|};

export type Async<T> = T | Promise<T>;

export type ResolveFn = (from: FilePath, to: string) => Promise<FilePath>;

type ResolveConfigFn = (
  configNames: Array<FilePath>,
) => Promise<FilePath | null>;

type ResolveConfigWithPathFn = (
  configNames: Array<FilePath>,
  assetFilePath: string,
) => Promise<FilePath | null>;

export type ValidateResult = {|
  warnings: Array<Diagnostic>,
  errors: Array<Diagnostic>,
|};

export type DedicatedThreadValidator = {|
  validateAll: ({|
    assets: Asset[],
    resolveConfigWithPath: ResolveConfigWithPathFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<Array<?ValidateResult>>,
|};

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

export type Validator = DedicatedThreadValidator | MultiThreadValidator;

/**
 * The methods for a transformer plugin.
 * @method getConfig (deprecated)
 * @method loadConfig FIXME
 * @method preSerializeConfig FIXME
 * @method postDeserializeConfig FIXME
 * @method canReuseAST Whether an AST from a previous transformer can be reused (to prevent double-parsing)
 * @method parse Parse the contents into an ast
 * @method transform Transform the asset and/or add new assets
 * @method generate Stringify the AST
 * @method postProcess FIXME what is this even for?
 */
export type Transformer = {|
  // TODO: deprecate getConfig
  getConfig?: ({|
    asset: MutableAsset,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<ConfigResult | void>,
  loadConfig?: ({|
    config: Config,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<void>,
  preSerializeConfig?: ({|
    config: Config,
    options: PluginOptions,
  |}) => Async<void>,
  postDeserializeConfig?: ({|
    config: Config,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<void>,
  canReuseAST?: ({|
    ast: AST,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => boolean,
  parse?: ({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<?AST>,
  transform({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<Array<TransformerResult | MutableAsset>>,
  generate?: ({|
    asset: Asset,
    ast: AST,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<GenerateOutput>,
  postProcess?: ({|
    assets: Array<MutableAsset>,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger,
  |}) => Async<Array<TransformerResult>>,
|};

/**
 * Used to control a traversal
 * @method skipChildren Skip the current node's children and continue the traversal if there are other nodes in the queue.
 * @method stop Stop the traversal
 */
export interface TraversalActions {
  skipChildren(): void;
  stop(): void;
}

/**
 * Essentially GraphTraversalCallback, but allows adding specific node enter and exit callbacks.
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
 * This can be used to propagate information from the parent to children (unlike a global variable).
 */
export type GraphTraversalCallback<TNode, TContext> = (
  node: TNode,
  context: ?TContext,
  actions: TraversalActions,
) => ?TContext;

export type BundleTraversable =
  | {|+type: 'asset', value: Asset|}
  | {|+type: 'dependency', value: Dependency|};

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

 * @property isSplittable defaults to <code>entryAsset.isSplittable</code> or <code>false</code>
 */
export type CreateBundleOpts =
  | {|
      +uniqueKey?: string,
      +entryAsset: Asset,
      +target: Target,
      +isEntry?: ?boolean,
      +isInline?: ?boolean,
      +isSplittable?: ?boolean,
      +type?: ?string,
      +env?: ?Environment,
    |}
  | {|
      +uniqueKey: string,
      +entryAsset?: Asset,
      +target: Target,
      +isEntry?: ?boolean,
      +isInline?: ?boolean,
      +isSplittable?: ?boolean,
      +type: string,
      +env: Environment,
    |};

/**
 * Specifies a symbol in an asset
 * @property asset The Asset which exports the symbol.
 * @property exportSymbol under which name the symbol is exported
 * @property symbol The (global) identifier under which the symbol can be referenced.
 */
export type SymbolResolution = {|
  +asset: Asset,
  +exportSymbol: CodeSymbol | string,
  +symbol: void | null | CodeSymbol,
  // the location of the specifier that lead to this result
  +loc: ?SourceLocation,
|};

export type ExportSymbolResolution = {|
  ...SymbolResolution,
  +exportAs: CodeSymbol | string,
|};

/**
 * A Bundle (a collection of assets)
 * @property hashReference Whether this value is inside <code>filePath</code> it will be replace with the real hash at the end.
 * @property isEntry Whether this is an entry (e.g. should not be hashed).
 * @property isInline Whether this bundle should be inlined into the parent bundle(s),
 * @property isSplittable FIXME
 * @property filePath The output filespath (if not inline), can contain <code>hashReference</code> before the optimizer ran.
 *
 * @method getEntryAssets Assets that run when the bundle is loaded (e.g. runtimes could be added). VERIFY
 * @method getMainEntry The actual entry (which won't be a runtime), the same as the last entry in <code>getEntryAssets()</code>
 * @method traverseAssets Traverses the assets in the bundle.
 * @method traverse Traverses assets and dependencies (see BundleTraversable).
 */
export interface Bundle {
  +id: string;
  +hashReference: string;
  +type: string;
  +env: Environment;
  +filePath: ?FilePath;
  +isEntry: ?boolean;
  +isInline: ?boolean;
  +isSplittable: ?boolean;
  +target: Target;
  +stats: Stats;
  getEntryAssets(): Array<Asset>;
  getMainEntry(): ?Asset;
  hasAsset(Asset): boolean;
  traverseAssets<TContext>(visit: GraphVisitor<Asset, TContext>): ?TContext;
  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>,
  ): ?TContext;
}

/**
 * A Bundler that got named by a Namer
 */
export interface NamedBundle extends Bundle {
  +filePath: FilePath;
  +name: string;
  +displayName: string;
}

/**
 * A collection of sibling bundles (which are stored in the BundleGraph) that should be loaded together.
 */
export type BundleGroup = {|
  target: Target,
  entryAssetId: string,
  bundleIds: Array<string>,
|};

/**
 * A BundleGraph in the Bundler that can be modified
 * @method addAssetGraphToBundle Add asset and all child nodes to the bundle VERIFY how??
 * @method createAssetReference FIXME
 * @method createBundleGroup Turns an edge (Dependency -> Asset-s) into (Dependency -> BundleGroup -> Asset-s)
 * @method getDependencyAssets FIXME a dependency can have multiple child nodes?
 * @method removeAssetGraphFromBundle Remove all "contains" edges from the bundle to the nodes in the asset's subgraph.
 * @method internalizeAsyncDependency Turns a dependency to a different bundle into a dependency to an asset inside <code>bundle</code>.
 * @method traverse FIME difference to traverseContents?
 * @method traverseContents FIXME
 */
export interface MutableBundleGraph extends BundleGraph<Bundle> {
  addAssetGraphToBundle(Asset, Bundle): void;
  addBundleToBundleGroup(Bundle, BundleGroup): void;
  createAssetReference(Dependency, Asset): void;
  createBundleReference(Bundle, Bundle): void;
  createBundle(CreateBundleOpts): Bundle;
  createBundleGroup(Dependency, Target): BundleGroup;
  getDependencyAssets(Dependency): Array<Asset>;
  getParentBundlesOfBundleGroup(BundleGroup): Array<Bundle>;
  getTotalSize(Asset): number;
  removeAssetGraphFromBundle(Asset, Bundle): void;
  removeBundleGroup(bundleGroup: BundleGroup): void;
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
 * @method getChildBundles Child bundles are Bundles that might be loaded by an asset in the bundle
 * @method getSiblingBundles See BundleGroup
 * @method getReferencedBundles Bundles that are referenced (by filename)
 * @method getDependencies Get the dependencies of the asset
 * @method getIncomingDependencies Get the dependencies that require the asset
 * @method resolveExternalDependency Returns undefined if the specified dependency was excluded or wasn't async \
 * and otherwise the BundleGroup or Asset that the dependency resolves to. VERIFY
 * @method getDependencyResolution Find out which asset the dependency resolved to.
 * @method isAssetInAncestorBundles Whether the asset is already included in a compatible (regarding EnvironmentContext) parent bundle.
 * @method isAssetReferenced Whether the asset is referenced (the "references" edge)FIXME how? url/filename?
 * @method isAssetReferencedByDependant Whether the asset is referenced by URL which could cause an import.
 * @method resolveSymbol <code>asset</code> exports <code>symbol</code>, try to find the asset where the \
 * corresponding variable lives (resolves re-exports). Stop resolving transitively once \
 * <code>boundary</code> was left (<code>bundle.hasAsset(asset) === false</code>), then <code>result.symbol</code> is undefined.
 * @method getExportedSymbols Gets the symbols that are (transivitely) exported by the asset
 */
export interface BundleGraph<TBundle: Bundle> {
  getBundles(): Array<TBundle>;
  getBundleGroupsContainingBundle(bundle: Bundle): Array<BundleGroup>;
  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<TBundle>;
  getChildBundles(bundle: Bundle): Array<TBundle>;
  getParentBundles(bundle: Bundle): Array<TBundle>;
  getSiblingBundles(bundle: Bundle): Array<TBundle>;
  getReferencedBundles(bundle: Bundle): Array<TBundle>;
  getDependencies(asset: Asset): Array<Dependency>;
  getIncomingDependencies(asset: Asset): Array<Dependency>;
  resolveExternalDependency(
    dependency: Dependency,
    bundle: ?Bundle,
  ): ?(
    | {|type: 'bundle_group', value: BundleGroup|}
    | {|type: 'asset', value: Asset|}
  );
  isDependencyDeferred(dependency: Dependency): boolean;
  getDependencyResolution(dependency: Dependency, bundle: ?Bundle): ?Asset;
  findBundlesWithAsset(Asset): Array<TBundle>;
  findBundlesWithDependency(Dependency): Array<TBundle>;
  isAssetReachableFromBundle(asset: Asset, bundle: Bundle): boolean;
  findReachableBundleWithAsset(bundle: Bundle, asset: Asset): ?TBundle;
  isAssetReferenced(asset: Asset): boolean;
  isAssetReferencedByDependant(bundle: Bundle, asset: Asset): boolean;
  hasParentBundleOfType(bundle: Bundle, type: string): boolean;
  /**
   * Resolve the export `symbol` of `asset` to the source,
   * stopping at the first asset after leaving `bundle`.
   * `symbol === null`: bailout (== caller should do `asset.exports[exportsSymbol]`)
   * `symbol === undefined`: symbol not found
   */
  resolveSymbol(
    asset: Asset,
    symbol: CodeSymbol,
    boundary: ?Bundle,
  ): SymbolResolution;
  getExportedSymbols(asset: Asset): Array<ExportSymbolResolution>;
  traverseBundles<TContext>(
    visit: GraphVisitor<TBundle, TContext>,
    startBundle: ?Bundle,
  ): ?TContext;
}

export type BundleResult = {|
  +contents: Blob,
  +ast?: AST,
  +map?: ?SourceMap,
|};

/**
 * @property sideEffects Corresponds to BaseAsset's <code>sideEffects</code>.
 * @property code A resolver might want to resolve to a dummy, in this case <code>filePath</code> is rather "resolve from".
 */
export type ResolveResult = {|
  +filePath?: FilePath,
  +isExcluded?: boolean,
  +sideEffects?: boolean,
  +code?: string,
|};

/**
 * Turns an asset graph into a BundleGraph.
 *
 * The two methods just run in series and are functionally identitical.
 */
export type Bundler = {|
  bundle({|
    bundleGraph: MutableBundleGraph,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void>,
  optimize({|
    bundleGraph: MutableBundleGraph,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void>,
|};

/**
 * @method name Return a filename/filepath for <code>bundle</code>.
 */
export type Namer = {|
  name({|
    bundle: Bundle,
    bundleGraph: BundleGraph<Bundle>,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<?FilePath>,
|};

/**
 * A "synthetic" asset that will be inserted into the bundle graph.
 */
export type RuntimeAsset = {|
  +filePath: FilePath,
  +code: string,
  +dependency?: Dependency,
  +isEntry?: boolean,
|};

export type Runtime = {|
  apply({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<void | RuntimeAsset | Array<RuntimeAsset>>,
|};

export type Packager = {|
  package({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph<NamedBundle>,
    options: PluginOptions,
    logger: PluginLogger,
    getInlineBundleContents: (
      Bundle,
      BundleGraph<NamedBundle>,
    ) => Async<{|contents: Blob|}>,
    getSourceMapReference: (map: ?SourceMap) => Async<?string>,
  |}): Async<BundleResult>,
|};

export type Optimizer = {|
  optimize({|
    bundle: NamedBundle,
    contents: Blob,
    map: ?SourceMap,
    options: PluginOptions,
    logger: PluginLogger,
    getSourceMapReference: (map: ?SourceMap) => Async<?string>,
  |}): Async<BundleResult>,
|};

export type Resolver = {|
  resolve({|
    dependency: Dependency,
    options: PluginOptions,
    logger: PluginLogger,
    filePath: FilePath,
  |}): Async<?ResolveResult>,
|};

export type ProgressLogEvent = {|
  +type: 'log',
  +level: 'progress',
  +phase?: string,
  +message: string,
|};

/**
 * A log event with a rich diagnostic
 */
export type DiagnosticLogEvent = {|
  +type: 'log',
  +level: 'error' | 'warn' | 'info' | 'verbose',
  +diagnostics: Array<Diagnostic>,
|};

export type TextLogEvent = {|
  +type: 'log',
  +level: 'success',
  +message: string,
|};

export type LogEvent = ProgressLogEvent | DiagnosticLogEvent | TextLogEvent;

/**
 * The build just started.
 */
export type BuildStartEvent = {|
  +type: 'buildStart',
|};

/**
 * The build just started in watch mode.
 */
type WatchStartEvent = {|
  +type: 'watchStart',
|};

/**
 * The build just ended in watch mode.
 */
type WatchEndEvent = {|
  +type: 'watchEnd',
|};

/**
 * A new Dependency is being resolved.
 */
type ResolvingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'resolving',
  +dependency: Dependency,
|};

/**
 * A new Asset is being transformed.
 */
type TransformingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'transforming',
  +filePath: FilePath,
|};

/**
 * The BundleGraph is generated.
 */
type BundlingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'bundling',
|};

/**
 * A new Bundle is being packaged.
 */
type PackagingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'packaging',
  +bundle: NamedBundle,
|};

/**
 * A new Bundle is being optimized.
 */
type OptimizingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'optimizing',
  +bundle: NamedBundle,
|};

export type BuildProgressEvent =
  | ResolvingProgressEvent
  | TransformingProgressEvent
  | BundlingProgressEvent
  | PackagingProgressEvent
  | OptimizingProgressEvent;

/**
 * The build was successful.
 */
export type BuildSuccessEvent = {|
  +type: 'buildSuccess',
  +bundleGraph: BundleGraph<NamedBundle>,
  +buildTime: number,
  +changedAssets: Map<string, Asset>,
|};

/**
 * The build failed.
 */
export type BuildFailureEvent = {|
  +type: 'buildFailure',
  +diagnostics: Array<Diagnostic>,
|};

export type BuildEvent = BuildFailureEvent | BuildSuccessEvent;

/**
 * A new file is being validated.
 */
export type ValidationEvent = {|
  +type: 'validation',
  +filePath: FilePath,
|};

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
 * A build event listener
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
