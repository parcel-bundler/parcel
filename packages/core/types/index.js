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

export type ParcelConfigFile = {|
  extends?: PackageName | FilePath | Array<PackageName | FilePath>,
  resolvers?: Array<PackageName>,
  transforms?: {[Glob]: Array<PackageName>, ...},
  bundler?: PackageName,
  namers?: Array<PackageName>,
  runtimes?: {[EnvironmentContext]: Array<PackageName>, ...},
  packagers?: {[Glob]: PackageName, ...},
  optimizers?: {[Glob]: Array<PackageName>, ...},
  reporters?: Array<PackageName>,
  validators?: {[Glob]: Array<PackageName>, ...}
|};

export type ResolvedParcelConfigFile = {|
  ...ParcelConfigFile,
  filePath: FilePath,
  resolveFrom?: FilePath
|};

export type Engines = {
  browsers?: string | Array<string>,
  electron?: SemverRange,
  node?: SemverRange,
  parcel?: SemverRange,
  ...
};

export type TargetSourceMapOptions = {|
  sourceRoot?: string,
  inline?: boolean,
  inlineSources?: boolean
|};

export interface Target {
  +distEntry: ?FilePath;
  +distDir: FilePath;
  +env: Environment;
  +sourceMap: ?TargetSourceMapOptions;
  +name: string;
  +publicUrl: ?string;
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
  context?: EnvironmentContext,
  engines?: Engines,
  includeNodeModules?: boolean | Array<PackageName>,
  outputFormat?: OutputFormat,
  publicUrl?: string,
  distDir?: FilePath,
  sourceMap?: TargetSourceMapOptions,
  isLibrary?: boolean
|};

export type TargetDescriptor = {|
  ...PackageTargetDescriptor,
  distDir: FilePath
|};

export type EnvironmentOpts = {|
  context?: EnvironmentContext,
  engines?: Engines,
  includeNodeModules?: boolean | Array<PackageName>,
  outputFormat?: OutputFormat,
  isLibrary?: boolean
|};

export type VersionMap = {
  [string]: string,
  ...
};

export interface Environment {
  +context: EnvironmentContext;
  +engines: Engines;
  +includeNodeModules: boolean | Array<PackageName>;
  +outputFormat: OutputFormat;
  +isLibrary: boolean;

  isBrowser(): boolean;
  isNode(): boolean;
  isElectron(): boolean;
  isWorker(): boolean;
  isIsolated(): boolean;
  matchesEngines(minVersions: VersionMap): boolean;
}

type PackageDependencies = {|
  [PackageName]: Semver
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
  entries?: FilePath | Array<FilePath>,
  rootDir?: FilePath,
  config?: ResolvedParcelConfigFile,
  defaultConfig?: ResolvedParcelConfigFile,
  env?: {[string]: string, ...},
  targets?: ?(Array<string> | {+[string]: TargetDescriptor, ...}),

  disableCache?: boolean,
  cacheDir?: FilePath,
  killWorkers?: boolean,
  mode?: BuildMode,
  minify?: boolean,
  scopeHoist?: boolean,
  sourceMaps?: boolean,
  hot?: ServerOptions | false,
  serve?: ServerOptions | false,
  autoinstall?: boolean,
  logLevel?: LogLevel,
  profile?: boolean,
  patchConsole?: boolean,

  inputFS?: FileSystem,
  outputFS?: FileSystem,
  workerFarm?: WorkerFarm,
  packageManager?: PackageManager,
  defaultEngines?: Engines

  // contentHash
  // throwErrors
  // global?
  // detailedReport
|};

export interface PluginOptions {
  +mode: BuildMode;
  +minify: boolean;
  +scopeHoist: boolean;
  +sourceMaps: boolean;
  +env: {+[string]: string, ...};
  +hot: ServerOptions | false;
  +serve: ServerOptions | false;
  +autoinstall: boolean;
  +logLevel: LogLevel;
  +rootDir: FilePath;
  +projectRoot: FilePath;
  +cacheDir: FilePath;
  +inputFS: FileSystem;
  +outputFS: FileSystem;
  +packageManager: PackageManager;
}

export type ServerOptions = {|
  host?: string,
  port: number,
  https?: HTTPSOptions | boolean,
  publicUrl?: string
|};

export type HTTPSOptions = {|
  cert: FilePath,
  key: FilePath
|};

export type SourceLocation = {|
  filePath: string,
  start: {|
    line: number,
    column: number
  |},
  end: {|
    line: number,
    column: number
  |}
|};

export type Meta = {
  [string]: JSONValue,
  globals?: Map<string, ?{code: string, deps?: Array<string>, ...}>,
  ...
};

export type Symbol = string;

export type DependencyOptions = {|
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isURL?: boolean,
  isWeak?: ?boolean,
  loc?: SourceLocation,
  env?: EnvironmentOpts,
  meta?: Meta,
  target?: Target,
  symbols?: Map<Symbol, Symbol>
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
  +symbols: Map<Symbol, Symbol>;
  +pipeline: ?string;
}

export type File = {|
  filePath: FilePath,
  hash?: string
|};

export interface BaseAsset {
  +ast: ?AST;
  +env: Environment;
  +fs: FileSystem;
  +filePath: FilePath;
  +id: string;
  +meta: Meta;
  +isIsolated: boolean;
  +isInline: boolean;
  +isSource: boolean;
  +type: string;
  +symbols: Map<Symbol, Symbol>;
  +sideEffects: boolean;
  +uniqueKey: ?string;

  getCode(): Promise<string>;
  getBuffer(): Promise<Buffer>;
  getStream(): Readable;
  getMap(): Promise<?SourceMap>;
  getIncludedFiles(): $ReadOnlyArray<File>;
  getDependencies(): $ReadOnlyArray<Dependency>;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean
    |}
  ): Promise<ConfigResult | null>;
  getPackage(): Promise<PackageJSON | null>;
}

export interface MutableAsset extends BaseAsset {
  ast: ?AST;
  isIsolated: boolean;
  isInline: boolean;
  type: string;

  addDependency(dep: DependencyOptions): string;
  setMap(?SourceMap): void;
  setCode(string): void;
  setBuffer(Buffer): void;
  setStream(Readable): void;
  addIncludedFile(file: File): void;
  addDependency(opts: DependencyOptions): string;
  addURLDependency(url: string, opts: $Shape<DependencyOptions>): string;
}

export interface Asset extends BaseAsset {
  +outputHash: string;
  +stats: Stats;
}

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
      exclude?: boolean
    |}
  ): Promise<ConfigResult | null>;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean
    |}
  ): Promise<ConfigResult | null>;
  getPackage(): Promise<PackageJSON | null>;
  shouldRehydrate(): void;
  shouldReload(): void;
  shouldInvalidateOnStartup(): void;
}

export type Stats = {|
  time: number,
  size: number
|};

export type GenerateOutput = {|
  code: string,
  map?: ?SourceMap
|};

export type Blob = string | Buffer | Readable;

export interface TransformerResult {
  type: string;
  code?: string;
  map?: ?SourceMap;
  content?: Blob;
  ast?: ?AST;
  dependencies?: $ReadOnlyArray<DependencyOptions>;
  includedFiles?: $ReadOnlyArray<File>;
  isIsolated?: boolean;
  isInline?: boolean;
  isSource?: boolean;
  env?: EnvironmentOpts;
  meta?: Meta;
  pipeline?: ?string;
  symbols?: Map<Symbol, Symbol>;
  sideEffects?: boolean;
  uniqueKey?: ?string;
}

export type Async<T> = T | Promise<T>;

export type ResolveFn = (from: FilePath, to: string) => Promise<FilePath>;

type ResolveConfigFn = (
  configNames: Array<FilePath>
) => Promise<FilePath | null>;

export type ValidateResult = {|
  warnings: Array<Diagnostic>,
  errors: Array<Diagnostic>
|};

export type Validator = {|
  validate({|
    asset: Asset,
    config: ConfigResult | void,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<ValidateResult | void>,
  getConfig?: ({|
    asset: Asset,
    resolveConfig: ResolveConfigFn,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<ConfigResult | void>
|};

export type Transformer = {|
  // TODO: deprecate getConfig
  getConfig?: ({|
    asset: MutableAsset,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<ConfigResult | void>,
  loadConfig?: ({|
    config: Config,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<void>,
  preSerializeConfig?: ({|
    config: Config,
    options: PluginOptions
  |}) => Async<void>,
  postDeserializeConfig?: ({|
    config: Config,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<void>,
  canReuseAST?: ({|
    ast: AST,
    options: PluginOptions,
    logger: PluginLogger
  |}) => boolean,
  parse?: ({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<?AST>,
  transform({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<Array<TransformerResult | MutableAsset>>,
  generate?: ({|
    asset: MutableAsset,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<GenerateOutput>,
  postProcess?: ({|
    assets: Array<MutableAsset>,
    config: ?ConfigResult,
    resolve: ResolveFn,
    options: PluginOptions,
    logger: PluginLogger
  |}) => Async<Array<TransformerResult>>
|};

export interface TraversalActions {
  skipChildren(): void;
  stop(): void;
}

export type GraphVisitor<TNode, TContext> =
  | GraphTraversalCallback<TNode, TContext>
  | {|
      enter?: GraphTraversalCallback<TNode, TContext>,
      exit?: GraphTraversalCallback<TNode, TContext>
    |};
export type GraphTraversalCallback<TNode, TContext> = (
  node: TNode,
  context: ?TContext,
  actions: TraversalActions
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
      id?: string,
      entryAsset: Asset,
      target: Target,
      isEntry?: ?boolean,
      isInline?: ?boolean,
      type?: ?string,
      env?: ?Environment
    |}
  // If an entryAsset is not provided, a bundle id, type, and environment must
  // be provided.
  | {|
      id: string,
      entryAsset?: Asset,
      target: Target,
      isEntry?: ?boolean,
      isInline?: ?boolean,
      type: string,
      env: Environment
    |};

export type SymbolResolution = {|
  asset: Asset,
  exportSymbol: Symbol | string,
  symbol: void | Symbol
|};

export interface Bundle {
  +id: string;
  +type: string;
  +env: Environment;
  +isEntry: ?boolean;
  +isInline: ?boolean;
  +target: Target;
  +filePath: ?FilePath;
  +name: ?string;
  +stats: Stats;
  getEntryAssets(): Array<Asset>;
  getMainEntry(): ?Asset;
  hasAsset(Asset): boolean;
  getHash(): string;
  traverseAssets<TContext>(visit: GraphVisitor<Asset, TContext>): ?TContext;
  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>
  ): ?TContext;
}

export interface NamedBundle extends Bundle {
  +filePath: FilePath;
  +name: string;
}

export type BundleGroup = {|
  target: Target,
  entryAssetId: string
|};

export interface MutableBundleGraph {
  addAssetGraphToBundle(Asset, Bundle): void;
  addBundleToBundleGroup(Bundle, BundleGroup): void;
  createAssetReference(Dependency, Asset): void;
  createBundle(CreateBundleOpts): Bundle;
  createBundleGroup(Dependency, Target): BundleGroup;
  findBundlesWithAsset(Asset): Array<Bundle>;
  getDependencyAssets(Dependency): Array<Asset>;
  getDependencyResolution(Dependency): ?Asset;
  getBundleGroupsContainingBundle(Bundle): Array<BundleGroup>;
  getBundlesInBundleGroup(BundleGroup): Array<Bundle>;
  getTotalSize(Asset): number;
  isAssetInAncestorBundles(Bundle, Asset): boolean;
  removeAssetGraphFromBundle(Asset, Bundle): void;
  traverse<TContext>(
    GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext;
  traverseBundles<TContext>(GraphVisitor<Bundle, TContext>): ?TContext;
  traverseContents<TContext>(
    GraphVisitor<BundlerBundleGraphTraversable, TContext>
  ): ?TContext;
}

export interface BundleGraph {
  getBundles(): Array<Bundle>;
  getBundleGroupsContainingBundle(bundle: Bundle): Array<BundleGroup>;
  getBundleGroupsReferencedByBundle(
    bundle: Bundle
  ): Array<{|
    bundleGroup: BundleGroup,
    dependency: Dependency
  |}>;
  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<Bundle>;
  getChildBundles(bundle: Bundle): Array<Bundle>;
  getSiblingBundles(bundle: Bundle): Array<Bundle>;
  getDependencies(asset: Asset): Array<Dependency>;
  getIncomingDependencies(asset: Asset): Array<Dependency>;
  getDependencyResolution(dependency: Dependency): ?Asset;
  isAssetInAncestorBundles(bundle: Bundle, asset: Asset): boolean;
  isAssetReferenced(asset: Asset): boolean;
  isAssetReferencedByAssetType(asset: Asset, type: string): boolean;
  hasParentBundleOfType(bundle: Bundle, type: string): boolean;
  resolveSymbol(asset: Asset, symbol: Symbol): SymbolResolution;
  getExportedSymbols(asset: Asset): Array<SymbolResolution>;
  traverseBundles<TContext>(
    visit: GraphTraversalCallback<Bundle, TContext>
  ): ?TContext;
  findBundlesWithAsset(Asset): Array<Bundle>;
}

export type BundleResult = {|
  contents: Blob,
  ast?: AST,
  map?: ?SourceMap
|};

export type ResolveResult = {|
  filePath?: FilePath,
  isExcluded?: boolean,
  sideEffects?: boolean,
  code?: string
|};

export type Bundler = {|
  bundle({|
    bundleGraph: MutableBundleGraph,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<void>,
  optimize({|
    bundleGraph: MutableBundleGraph,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<void>
|};

export type Namer = {|
  name({|
    bundle: Bundle,
    bundleGraph: BundleGraph,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<?FilePath>
|};

export type RuntimeAsset = {|
  filePath: FilePath,
  code: string,
  dependency?: Dependency,
  isEntry?: boolean
|};

export type Runtime = {|
  apply({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<void | RuntimeAsset | Array<RuntimeAsset>>
|};

export type Packager = {|
  package({|
    bundle: NamedBundle,
    bundleGraph: BundleGraph,
    options: PluginOptions,
    getSourceMapReference: (map: SourceMap) => Promise<string> | string,
    logger: PluginLogger,
    getInlineBundleContents: (
      Bundle,
      BundleGraph
    ) => Async<{|contents: Blob, map: ?(Readable | string)|}>
  |}): Async<BundleResult>
|};

export type Optimizer = {|
  optimize({|
    bundle: NamedBundle,
    contents: Blob,
    map: ?SourceMap,
    options: PluginOptions,
    logger: PluginLogger
  |}): Async<BundleResult>
|};

export type Resolver = {|
  resolve({|
    dependency: Dependency,
    options: PluginOptions,
    logger: PluginLogger,
    filePath: FilePath
  |}): Async<?ResolveResult>
|};

export type ProgressLogEvent = {|
  +type: 'log',
  +level: 'progress',
  +message: string
|};

export type DiagnosticLogEvent = {|
  +type: 'log',
  +level: 'error' | 'warn' | 'info' | 'verbose',
  +diagnostics: Array<Diagnostic>
|};

export type TextLogEvent = {|
  +type: 'log',
  +level: 'success',
  +message: string
|};

export type LogEvent = ProgressLogEvent | DiagnosticLogEvent | TextLogEvent;

export type BuildStartEvent = {|
  type: 'buildStart'
|};

type WatchStartEvent = {|
  type: 'watchStart'
|};

type WatchEndEvent = {|
  type: 'watchEnd'
|};

type ResolvingProgressEvent = {|
  type: 'buildProgress',
  phase: 'resolving',
  dependency: Dependency
|};

type TransformingProgressEvent = {|
  type: 'buildProgress',
  phase: 'transforming',
  filePath: FilePath
|};

type BundlingProgressEvent = {|
  type: 'buildProgress',
  phase: 'bundling'
|};

type PackagingProgressEvent = {|
  type: 'buildProgress',
  phase: 'packaging',
  bundle: NamedBundle
|};

type OptimizingProgressEvent = {|
  type: 'buildProgress',
  phase: 'optimizing',
  bundle: NamedBundle
|};

export type BuildProgressEvent =
  | ResolvingProgressEvent
  | TransformingProgressEvent
  | BundlingProgressEvent
  | PackagingProgressEvent
  | OptimizingProgressEvent;

export type BuildSuccessEvent = {|
  type: 'buildSuccess',
  bundleGraph: BundleGraph,
  buildTime: number,
  changedAssets: Map<string, Asset>
|};

export type BuildFailureEvent = {|
  type: 'buildFailure',
  diagnostics: Array<Diagnostic>
|};

export type BuildEvent = BuildFailureEvent | BuildSuccessEvent;

export type ValidationEvent = {|
  type: 'validation',
  filePath: FilePath
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
    logger: PluginLogger
  |}): Async<void>
|};

export interface ErrorWithCode extends Error {
  code?: string;
}

export interface IDisposable {
  dispose(): mixed;
}

export interface AsyncSubscription {
  unsubscribe(): Promise<mixed>;
}
