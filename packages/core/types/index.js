// @flow strict-local

import type {Readable} from 'stream';

import type {AST as _AST, Config as _Config} from './unsafe';

export type AST = _AST;
export type Config = _Config;

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | Array<JSONValue>
  | JSONObject;

export type JSONObject = {
  [key: string]: JSONValue
};

export type PackageName = string;
export type FilePath = string;
export type Glob = string;
type Semver = string;
type SemverRange = string;
export type ModuleSpecifier = string;

export type GlobMap<T> = {[Glob]: T};

export type ParcelConfigFile = {
  extends?: PackageName | FilePath | Array<PackageName | FilePath>,
  resolvers?: Array<PackageName>,
  transforms?: {
    [Glob]: Array<PackageName>
  },
  bundler?: PackageName,
  namers?: Array<PackageName>,
  runtimes?: {
    [EnvironmentContext]: Array<PackageName>
  },
  packagers?: {
    [Glob]: PackageName
  },
  optimizers?: {
    [Glob]: Array<PackageName>
  },
  reporters?: Array<PackageName>
};

export type ParcelConfig = ParcelConfigFile & {
  filePath: FilePath
};

export type Engines = {
  browsers?: Array<string>,
  electron?: SemverRange,
  node?: SemverRange,
  parcel?: SemverRange
};

export type Target = {|
  distEntry?: ?FilePath,
  distDir: FilePath,
  env: Environment,
  name: string,
  publicUrl?: string
|};

export type EnvironmentContext =
  | 'browser'
  | 'web-worker'
  | 'service-worker'
  | 'node'
  | 'electron';

export type EnvironmentOpts = {
  context: EnvironmentContext,
  engines: Engines,
  includeNodeModules?: boolean,
  publicUrl?: string
};

export interface Environment {
  context: EnvironmentContext;
  engines: Engines;
  includeNodeModules: boolean;

  merge(env: ?EnvironmentOpts): Environment;
  isBrowser(): boolean;
  isNode(): boolean;
  isElectron(): boolean;
  isIsolated(): boolean;
}

type PackageDependencies = {|
  [PackageName]: Semver
|};

export type PackageJSON = {
  name: PackageName,
  version: Semver,
  main?: FilePath,
  module?: FilePath,
  browser?: FilePath | {[FilePath]: FilePath | boolean},
  source?: FilePath | {[FilePath]: FilePath},
  alias?: {
    [PackageName | FilePath | Glob]: PackageName | FilePath
  },
  browserslist?: Array<string>,
  engines?: Engines,
  targets?: {
    [string]: EnvironmentOpts
  },
  dependencies?: PackageDependencies,
  devDependencies?: PackageDependencies,
  peerDependencies?: PackageDependencies,
  sideEffects?: boolean | FilePath | Array<FilePath>
};

export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'verbose';

export type InitialParcelOptions = {|
  entries?: FilePath | Array<FilePath>,
  rootDir?: FilePath,
  config?: ParcelConfig,
  defaultConfig?: ParcelConfig,
  env?: {[string]: ?string},
  targets?: ?Array<string | Target>,

  cache?: boolean,
  cacheDir?: FilePath,
  killWorkers?: boolean,
  mode?: 'development' | 'production' | string,
  minify?: boolean,
  scopeHoist?: boolean,
  sourceMaps?: boolean,
  hot?: ServerOptions | false,
  serve?: ServerOptions | false,
  autoinstall?: boolean,
  logLevel?: LogLevel

  // contentHash
  // throwErrors
  // global?
  // detailedReport
|};

export type ParcelOptions = {|
  ...InitialParcelOptions,
  cacheDir: FilePath,
  entries: Array<FilePath>,
  logLevel: LogLevel,
  rootDir: FilePath,
  targets: Array<Target>,
  projectRoot: FilePath
|};

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
  start: {line: number, column: number},
  end: {line: number, column: number}
|};

export type Meta = {
  globals?: Map<string, {code: string}>,
  [string]: JSONValue
};

export type Symbol = string;

export type DependencyOptions = {|
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isURL?: boolean,
  isWeak?: boolean,
  loc?: SourceLocation,
  env?: EnvironmentOpts,
  meta?: Meta,
  target?: Target,
  symbols?: Map<Symbol, Symbol> | Array<[Symbol, Symbol]>
|};

export interface Dependency {
  id: string;
  moduleSpecifier: ModuleSpecifier;
  isAsync: ?boolean;
  isEntry: ?boolean;
  isOptional: ?boolean;
  isURL: ?boolean;
  isWeak: ?boolean;
  loc: ?SourceLocation;
  env: Environment;
  meta: Meta;
  target: ?Target;
  symbols: Map<Symbol, Symbol>;

  // TODO: get this from graph instead of storing them on dependencies
  sourcePath: ?FilePath;

  merge(other: Dependency): void;
}

export type File = {
  filePath: FilePath,
  hash?: string
};

export type AssetRequest = {|
  filePath: FilePath,
  env: Environment,
  sideEffects?: boolean,
  code?: string
|};

interface BaseAsset {
  +ast: ?AST;
  +env: Environment;
  +filePath: FilePath;
  +id: string;
  +meta: Meta;
  +isIsolated: boolean;
  +type: string;
  +symbols: Map<Symbol, Symbol>;
  +sideEffects: boolean;

  getCode(): Promise<string>;
  getBuffer(): Promise<Buffer>;
  getStream(): Readable;
  getMap(): ?SourceMap;
  getConnectedFiles(): $ReadOnlyArray<File>;
  getDependencies(): $ReadOnlyArray<Dependency>;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null>;
  getPackage(): Promise<PackageJSON | null>;
}

export interface MutableAsset extends BaseAsset {
  ast: ?AST;
  isIsolated: boolean;
  type: string;

  addDependency(dep: DependencyOptions): string;
  setMap(?SourceMap): void;
  setCode(string): void;
  setBuffer(Buffer): void;
  setStream(Readable): void;
  addConnectedFile(file: File): Promise<void>;
  addDependency(opts: DependencyOptions): string;
  addURLDependency(url: string, opts: $Shape<DependencyOptions>): string;
}

export interface Asset extends BaseAsset {
  +outputHash: string;
  +stats: Stats;
}

export type Stats = {|
  time: number,
  size: number
|};

export type GenerateOutput = {|
  code: string,
  map?: SourceMap
|};

export type SourceMap = JSONObject;
export type Blob = string | Buffer | Readable;

export interface TransformerResult {
  type: string;
  code?: string;
  content?: Blob;
  ast?: ?AST;
  dependencies?: $ReadOnlyArray<DependencyOptions>;
  connectedFiles?: $ReadOnlyArray<File>;
  isIsolated?: boolean;
  env?: EnvironmentOpts;
  meta?: Meta;
  symbols?: Map<Symbol, Symbol>;
  sideEffects?: boolean;
}

type Async<T> = T | Promise<T>;

export type Transformer = {
  getConfig?: ({
    asset: MutableAsset,
    resolve: (from: FilePath, to: string) => Promise<FilePath>,
    options: ParcelOptions
  }) => Async<Config | void>,
  canReuseAST?: ({ast: AST, options: ParcelOptions}) => boolean,
  parse?: ({
    asset: MutableAsset,
    config: ?Config,
    options: ParcelOptions
  }) => Async<?AST>,
  transform({
    asset: MutableAsset,
    config: ?Config,
    options: ParcelOptions
  }): Async<Array<TransformerResult | MutableAsset>>,
  generate?: ({
    asset: MutableAsset,
    config: ?Config,
    options: ParcelOptions
  }) => Async<GenerateOutput>,
  postProcess?: ({
    assets: Array<MutableAsset>,
    config: ?Config,
    options: ParcelOptions
  }) => Async<Array<TransformerResult>>
};

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

// Not a directly exported interface.
interface AssetGraphLike {
  getDependencies(asset: Asset): Array<Dependency>;
  getDependencyResolution(dependency: Dependency): ?Asset;
  traverseAssets<TContext>(visit: GraphVisitor<Asset, TContext>): ?TContext;
}

export type BundleTraversable =
  | {|+type: 'asset', value: Asset|}
  | {|+type: 'asset_reference', value: Asset|};

export type MainAssetGraphTraversable =
  | {|+type: 'asset', value: Asset|}
  | {|+type: 'dependency', value: Dependency|};

// Always read-only.
export interface MainAssetGraph extends AssetGraphLike {
  createBundle(asset: Asset): MutableBundle;
  traverse<TContext>(
    visit: GraphVisitor<MainAssetGraphTraversable, TContext>
  ): ?TContext;
}

export type SymbolResolution = {|
  asset: Asset,
  exportSymbol: Symbol | string,
  symbol: void | Symbol
|};

export interface Bundle extends AssetGraphLike {
  +id: string;
  +type: string;
  +env: Environment;
  +isEntry: ?boolean;
  +target: ?Target;
  +filePath: ?FilePath;
  +name: ?string;
  +stats: Stats;
  getEntryAssets(): Array<Asset>;
  getTotalSize(asset?: Asset): number;
  hasChildBundles(): boolean;
  traverse<TContext>(
    visit: GraphVisitor<BundleTraversable, TContext>
  ): ?TContext;
  traverseAncestors<TContext>(
    asset: Asset,
    visit: GraphVisitor<*, TContext>
  ): ?TContext;
  resolveSymbol(asset: Asset, symbol: Symbol): SymbolResolution;
}

export interface MutableBundle extends Bundle {
  isEntry: ?boolean;
  merge(Bundle): void;
  removeAsset(Asset): void;
}

export interface NamedBundle extends Bundle {
  +filePath: FilePath;
  +name: string;
}

export type BundleGroup = {
  dependency: Dependency,
  target: ?Target,
  entryAssetId: string
};

export interface BundleGraph {
  findBundlesWithAsset(asset: Asset): Array<Bundle>;
  getBundleGroupsContainingBundle(bundle: Bundle): Array<BundleGroup>;
  getBundleGroupsReferencedByBundle(bundle: Bundle): Array<BundleGroup>;
  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<Bundle>;
  isAssetInAncestorBundle(bundle: Bundle, asset: Asset): boolean;
  traverseBundles<TContext>(
    visit: GraphTraversalCallback<Bundle, TContext>
  ): ?TContext;
  isAssetReferenced(asset: Asset): boolean;
}

export interface MutableBundleGraph {
  addBundle(bundleGroup: BundleGroup, bundle: Bundle): void;
  addBundleGroup(parentBundle: ?Bundle, bundleGroup: BundleGroup): void;
  findBundlesWithAsset(asset: Asset): Array<MutableBundle>;
  getBundleGroupsContainingBundle(bundle: Bundle): Array<BundleGroup>;
  getBundleGroupsReferencedByBundle(bundle: Bundle): Array<BundleGroup>;
  getBundlesInBundleGroup(bundleGroup: BundleGroup): Array<MutableBundle>;
  isAssetInAncestorBundle(bundle: Bundle, asset: Asset): boolean;
  traverseBundles<TContext>(
    visit: GraphTraversalCallback<MutableBundle, TContext>
  ): ?TContext;
}

export type Bundler = {|
  bundle({
    assetGraph: MainAssetGraph,
    bundleGraph: MutableBundleGraph,
    options: ParcelOptions
  }): Async<void>
|};

export type Namer = {|
  name({
    bundle: Bundle,
    bundleGraph: BundleGraph,
    options: ParcelOptions
  }): Async<?FilePath>
|};

export type RuntimeAsset = {|
  filePath: FilePath,
  code: string,
  dependency?: Dependency
|};

export type Runtime = {|
  apply({
    bundle: NamedBundle,
    bundleGraph: BundleGraph,
    options: ParcelOptions
  }): Async<void | RuntimeAsset | Array<RuntimeAsset>>
|};

export type Packager = {|
  package({
    bundle: Bundle,
    bundleGraph: BundleGraph,
    options: ParcelOptions
  }): Async<Blob>
|};

export type Optimizer = {|
  optimize({bundle: Bundle, contents: Blob, options: ParcelOptions}): Async<
    Blob
  >
|};

export type Resolver = {|
  resolve({
    dependency: Dependency,
    options: ParcelOptions
  }): Async<?AssetRequest>
|};

export type ProgressLogEvent = {|
  +type: 'log',
  +level: 'progress',
  +message: string
|};

export type LogEvent =
  | ProgressLogEvent
  | {|
      +type: 'log',
      +level: 'error' | 'warn',
      +message: string | Error
    |}
  | {|
      +type: 'log',
      +level: 'info' | 'success' | 'verbose',
      +message: string
    |};

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
  request: AssetRequest
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
  assetGraph: MainAssetGraph,
  bundleGraph: BundleGraph,
  buildTime: number,
  changedAssets: Map<string, Asset>
|};

export type BuildFailureEvent = {|
  type: 'buildFailure',
  error: Error
|};

export type ReporterEvent =
  | LogEvent
  | BuildStartEvent
  | BuildProgressEvent
  | BuildSuccessEvent
  | BuildFailureEvent
  | WatchStartEvent
  | WatchEndEvent;

export type Reporter = {|
  report(event: ReporterEvent, opts: ParcelOptions): Async<void>
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
