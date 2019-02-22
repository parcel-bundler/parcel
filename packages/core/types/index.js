// @flow

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
export type ParcelConfig = {
  filePath: FilePath,
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

export type Engines = {
  node?: SemverRange,
  electron?: SemverRange,
  browsers?: Array<string>
};

export type Target = {
  name: string,
  distPath?: FilePath,
  env: Environment
};

export type EnvironmentContext =
  | 'browser'
  | 'web-worker'
  | 'service-worker'
  | 'node'
  | 'electron';

export type EnvironmentOpts = {
  context: EnvironmentContext,
  engines: Engines,
  includeNodeModules?: boolean
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

type PackageDependencies = {
  [PackageName]: Semver
};

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

export type ParcelOptions = {
  entries?: FilePath | Array<FilePath>,
  rootDir?: FilePath,
  config?: ParcelConfig,
  defaultConfig?: ParcelConfig,
  env?: {[string]: ?string},
  targets?: Array<Target>,

  watch?: boolean,
  cache?: boolean,
  cacheDir?: FilePath,
  killWorkers?: boolean,
  mode?: 'development' | 'production' | string,
  minify?: boolean,
  sourceMaps?: boolean,
  publicUrl?: string,
  hot?: ServerOptions | boolean,
  serve?: ServerOptions | boolean,
  autoinstall?: boolean,
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'verbose'

  // contentHash
  // scopeHoist
  // throwErrors
  // global?
  // detailedReport
};

export type ServerOptions = {
  host?: string,
  port?: number,
  https?: HTTPSOptions | boolean
};

export type HTTPSOptions = {
  cert?: FilePath,
  key?: FilePath
};

export type SourceLocation = {
  filePath: string,
  start: {line: number, column: number},
  end: {line: number, column: number}
};

export type Symbol = string;

export type Meta = {[string]: any};
export type DependencyOptions = {|
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isURL?: boolean,
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
  loc: ?SourceLocation;
  env: Environment;
  meta: Meta;
  target: ?Target;
  symbols: Map<Symbol, Symbol>;

  // TODO: get this from graph instead of storing them on dependencies
  sourcePath: FilePath;
}

export type File = {
  filePath: FilePath,
  hash?: string
};

export type TransformerRequest = {
  filePath: FilePath,
  env: Environment,
  code?: string
};

export interface Asset {
  id: string;
  hash: string;
  filePath: FilePath;
  type: string;
  code: string;
  ast: ?AST;
  dependencies: Array<Dependency>;
  connectedFiles: Array<File>;
  output: AssetOutput;
  outputHash: string;
  env: Environment;
  meta: Meta;
  stats: Stats;
  symbols: Map<Symbol, Symbol>;

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null>;
  getPackage(): Promise<PackageJSON | null>;
  addDependency(dep: DependencyOptions): string;
  createChildAsset(result: TransformerResult): Asset;
  getOutput(): Promise<AssetOutput>;
}

export type Stats = {
  time: number,
  size: number
};

export type AssetOutput = {
  code: string,
  map?: SourceMap,
  [string]: Blob | JSONValue
};

export type AST = {
  type: string,
  version: string,
  program: any,
  isDirty?: boolean
};

export type Config = any;
export type SourceMap = JSONObject;
export type Blob = string | Buffer;

export type TransformerResult = {
  type: string,
  code?: string,
  ast?: ?AST,
  dependencies?: Array<DependencyOptions>,
  connectedFiles?: Array<File>,
  output?: AssetOutput,
  env?: EnvironmentOpts,
  meta?: Meta,
  symbols?: Map<Symbol, Symbol>
};

type Async<T> = T | Promise<T>;

export type Transformer = {
  getConfig?: (asset: Asset, opts: ParcelOptions) => Async<Config | void>,
  canReuseAST?: (ast: AST, opts: ParcelOptions) => boolean,
  parse?: (asset: Asset, config: ?Config, opts: ParcelOptions) => Async<?AST>,
  transform(
    asset: Asset,
    config: ?Config,
    opts: ParcelOptions
  ): Async<Array<TransformerResult | Asset>>,
  generate?: (
    asset: Asset,
    config: ?Config,
    opts: ParcelOptions
  ) => Async<AssetOutput>,
  postProcess?: (
    assets: Array<Asset>,
    config: ?Config,
    opts: ParcelOptions
  ) => Async<Array<TransformerResult>>
};

export type CacheEntry = {
  filePath: FilePath,
  env: Environment,
  hash: string,
  assets: Array<Asset>,
  initialAssets: ?Array<Asset> // Initial assets, pre-post processing
};

export interface TraversalContext {
  skipChildren(): void;
  stop(): void;
}

export type GraphVisitor<T> =
  | GraphTraversalCallback<T>
  | {|
      enter?: GraphTraversalCallback<T>,
      exit?: GraphTraversalCallback<T>
    |};

export type GraphTraversalCallback<T> = (
  asset: T,
  context?: any,
  traversal: TraversalContext
) => any;

export interface Graph {
  merge(graph: Graph): void;
}

// TODO: what do we want to expose here?
export interface AssetGraph extends Graph {
  traverseAssets(visit: GraphVisitor<Asset>): any;
  createBundle(asset: Asset): Bundle;
  getTotalSize(asset?: Asset): number;
  getEntryAssets(): Array<Asset>;
  removeAsset(asset: Asset): void;
  getDependencies(asset: Asset): Array<Dependency>;
  getDependencyResolution(dependency: Dependency): ?Asset;
  resolveSymbol(asset: Asset, symbol: Symbol): {asset: Asset, symbol: Symbol};
}

export type BundleGroup = {
  dependency: Dependency,
  target: ?Target,
  entryAssetId: string
};

export type Bundle = {
  id: string,
  type: string,
  assetGraph: AssetGraph,
  env: Environment,
  isEntry?: boolean,
  target?: Target,
  filePath?: FilePath,
  stats: Stats
};

export interface BundleGraph {
  addBundleGroup(parentBundle: ?Bundle, bundleGroup: BundleGroup): void;
  addBundle(bundleGroup: BundleGroup, bundle: Bundle): void;
  isAssetInAncestorBundle(bundle: Bundle, asset: Asset): boolean;
  findBundlesWithAsset(asset: Asset): Array<Bundle>;
  getBundles(bundleGroup: BundleGroup): Array<Bundle>;
  getBundleGroups(bundle: Bundle): Array<BundleGroup>;
  traverseBundles(visit: GraphTraversalCallback<Bundle>): any;
}

export type Bundler = {
  bundle(
    graph: AssetGraph,
    bundleGraph: BundleGraph,
    opts: ParcelOptions
  ): Async<void>
};

export type Namer = {
  name(bundle: Bundle, opts: ParcelOptions): Async<?FilePath>
};

export type Runtime = {
  apply(bundle: Bundle, opts: ParcelOptions): Async<void>
};

export type Packager = {
  package(bundle: Bundle, opts: ParcelOptions): Async<Blob>
};

export type Optimizer = {
  optimize(bundle: Bundle, contents: Blob, opts: ParcelOptions): Async<Blob>
};

export type Resolver = {
  resolve(
    dependency: Dependency,
    opts: ParcelOptions,
    rootDir: string
  ): Async<FilePath | null>
};

export type LogEvent = {
  type: 'log',
  level: 'error' | 'warn' | 'info' | 'progress' | 'success' | 'verbose',
  message: string | Error
};

export type BuildStartEvent = {
  type: 'buildStart'
};

type ResolvingProgressEvent = {
  type: 'buildProgress',
  phase: 'resolving',
  dependency: Dependency
};

type TransformingProgressEvent = {
  type: 'buildProgress',
  phase: 'transforming',
  request: TransformerRequest
};

type BundlingProgressEvent = {
  type: 'buildProgress',
  phase: 'bundling'
};

type PackagingProgressEvent = {
  type: 'buildProgress',
  phase: 'packaging',
  bundle: Bundle
};

type OptimizingProgressEvent = {
  type: 'buildProgress',
  phase: 'optimizing',
  bundle: Bundle
};

export type BuildProgressEvent =
  | ResolvingProgressEvent
  | TransformingProgressEvent
  | BundlingProgressEvent
  | PackagingProgressEvent
  | OptimizingProgressEvent;

export type BuildSuccessEvent = {
  type: 'buildSuccess',
  assetGraph: AssetGraph,
  bundleGraph: BundleGraph,
  buildTime: number
};

export type BuildFailureEvent = {
  type: 'buildFailure',
  error: Error
};

export type ReporterEvent =
  | LogEvent
  | BuildStartEvent
  | BuildProgressEvent
  | BuildSuccessEvent
  | BuildFailureEvent;

export type Reporter = {
  report(event: ReporterEvent, opts: ParcelOptions): Async<void>
};
