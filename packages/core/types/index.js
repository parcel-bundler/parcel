// @flow strict-local

import type {Readable} from 'stream';
import type SourceMap from '@parcel/source-map';
import type {FileSystem} from '@parcel/fs';
import type WorkerFarm from '@parcel/workers';
import type {PackageManager} from '@parcel/package-manager';
import type {Diagnostic} from '@parcel/diagnostic';
import type {PluginLogger} from '@parcel/logger';

import type {AST as _AST, ConfigResult as _ConfigResult} from './unsafe';

export type AST = _AST;
export type ConfigResult = _ConfigResult;
export type ConfigResultWithFilePath = {|
  contents: ConfigResult,
  filePath: FilePath,
|};
export type EnvMap = typeof process.env;

export type JSONValue =
  | null
  | void // ? Is this okay?
  | boolean
  | number
  | string
  | Array<JSONValue>
  | JSONObject;

export type JSONObject = {[key: string]: JSONValue, ...};

export type PackageName = string;
export type FilePath = string;
export type Glob = string;
export type Semver = string;
export type SemverRange = string;
export type ModuleSpecifier = string;

export type GlobMap<T> = {[Glob]: T, ...};

export type RawParcelConfigPipeline = Array<PackageName>;

export type HMROptions = {port?: number, host?: string, ...};

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

export type ResolvedParcelConfigFile = {|
  ...RawParcelConfig,
  +filePath: FilePath,
  +resolveFrom?: FilePath,
|};

export type Engines = {
  +browsers?: string | Array<string>,
  +electron?: SemverRange,
  +node?: SemverRange,
  +parcel?: SemverRange,
  ...
};

export type TargetSourceMapOptions = {|
  +sourceRoot?: string,
  +inline?: boolean,
  +inlineSources?: boolean,
|};

export interface Target {
  +distEntry: ?FilePath;
  +distDir: FilePath;
  +env: Environment;
  +sourceMap: ?TargetSourceMapOptions;
  +name: string;
  +publicUrl: string;
  // The position of e.g. `package.json#main`
  +loc: ?SourceLocation;
}

export type EnvironmentContext =
  | 'browser'
  | 'web-worker'
  | 'service-worker'
  | 'node'
  | 'electron-main'
  | 'electron-renderer';

export type OutputFormat = 'esmodule' | 'commonjs' | 'global';
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

export type TargetDescriptor = {|
  ...PackageTargetDescriptor,
  +distDir: FilePath,
|};

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

export type VersionMap = {
  [string]: string,
  ...,
};

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

type PackageDependencies = {|
  [PackageName]: Semver,
|};

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
  +contentHash?: boolean,
  +serve?: InitialServerOptions | false,
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

export type InitialServerOptions = {|
  +publicUrl?: string,
  +host?: string,
  +port: number,
  +https?: HTTPSOptions | boolean,
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
  +projectRoot: FilePath;
  +cacheDir: FilePath;
  +inputFS: FileSystem;
  +outputFS: FileSystem;
  +packageManager: PackageManager;
  +instanceId: string;
  +detailedReport: number;
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

// Source locations are 1-based, meaning lines and columns start at 1
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

export type Meta = JSONObject;

export type Symbol = string;
export interface Symbols // eslint-disable-next-line no-undef
  extends Iterable<[Symbol, {|local: Symbol, loc: ?SourceLocation|}]> {
  get(exportSymbol: Symbol): ?{|local: Symbol, loc: ?SourceLocation|};
  hasExportSymbol(exportSymbol: Symbol): boolean;
  hasLocalSymbol(local: Symbol): boolean;
  // Whether static analysis bailed out
  +isCleared: boolean;
}
export interface MutableSymbols extends Symbols {
  // Static analysis bailed out
  clear(): void;
  set(exportSymbol: Symbol, local: Symbol, loc: ?SourceLocation): void;
}

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
  +symbols?: $ReadOnlyMap<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
|};

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
  +symbols: MutableSymbols;
}

export type File = {|
  +filePath: FilePath,
  +hash?: string,
|};

export type ASTGenerator = {|
  type: string,
  version: string,
|};

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
  +symbols: Symbols;

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

export interface MutableAsset extends BaseAsset {
  isIsolated: boolean;
  isInline: boolean;
  isSplittable: ?boolean;
  type: string;

  addDependency(dep: DependencyOptions): string;
  addIncludedFile(file: File): void;
  addURLDependency(url: string, opts: $Shape<DependencyOptions>): string;

  +symbols: MutableSymbols;

  isASTDirty(): boolean;
  setAST(AST): void;
  setBuffer(Buffer): void;
  setCode(string): void;
  setEnvironment(opts: EnvironmentOpts): void;
  setMap(?SourceMap): void;
  setStream(Readable): void;
}

export interface Asset extends BaseAsset {
  +stats: Stats;
}

export interface Config {
  +isSource: boolean;
  +searchPath: FilePath;
  +result: ConfigResult;
  +env: Environment;
  +includedFiles: Set<FilePath>;

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
  +symbols?: $ReadOnlyMap<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
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

export type Transformer = {|
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

export interface TraversalActions {
  skipChildren(): void;
  stop(): void;
}

export type GraphVisitor<TNode, TContext> =
  | GraphTraversalCallback<TNode, TContext>
  | {|
      enter?: GraphTraversalCallback<TNode, TContext>,
      exit?: GraphTraversalCallback<TNode, TContext>,
    |};
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
    |};

export type SymbolResolution = {|
  +asset: Asset,
  +exportSymbol: Symbol | string,
  +symbol: void | null | Symbol,
  // the location of the specifier that lead to this result
  +loc: ?SourceLocation,
|};

export type ExportSymbolResolution = {|
  ...SymbolResolution,
  +exportAs: Symbol | string,
|};

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

export interface NamedBundle extends Bundle {
  +filePath: FilePath;
  +name: string;
  +displayName: string;
}

export type BundleGroup = {|
  target: Target,
  entryAssetId: string,
  bundleIds: Array<string>,
|};

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
    symbol: Symbol,
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

export type ResolveResult = {|
  +filePath?: FilePath,
  +isExcluded?: boolean,
  +sideEffects?: boolean,
  +code?: string,
|};

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

export type Namer = {|
  name({|
    bundle: Bundle,
    bundleGraph: BundleGraph<Bundle>,
    options: PluginOptions,
    logger: PluginLogger,
  |}): Async<?FilePath>,
|};

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

export type BuildStartEvent = {|
  +type: 'buildStart',
|};

type WatchStartEvent = {|
  +type: 'watchStart',
|};

type WatchEndEvent = {|
  +type: 'watchEnd',
|};

type ResolvingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'resolving',
  +dependency: Dependency,
|};

type TransformingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'transforming',
  +filePath: FilePath,
|};

type BundlingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'bundling',
|};

type PackagingProgressEvent = {|
  +type: 'buildProgress',
  +phase: 'packaging',
  +bundle: NamedBundle,
|};

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

export type BuildSuccessEvent = {|
  +type: 'buildSuccess',
  +bundleGraph: BundleGraph<NamedBundle>,
  +buildTime: number,
  +changedAssets: Map<string, Asset>,
|};

export type BuildFailureEvent = {|
  +type: 'buildFailure',
  +diagnostics: Array<Diagnostic>,
|};

export type BuildEvent = BuildFailureEvent | BuildSuccessEvent;

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
