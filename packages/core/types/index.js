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
  name: string,
  distPath?: FilePath,
  distPathType?: string,
  env: Environment
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
  peerDependencies?: PackageDependencies
};

export type ParcelOptions = {|
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
  hot?: ServerOptions | false,
  serve?: ServerOptions | false,
  autoinstall?: boolean,
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'verbose'

  // contentHash
  // scopeHoist
  // throwErrors
  // global?
  // detailedReport
|};

export type ServerOptions = {|
  host?: string,
  port: number,
  https?: HTTPSOptions | boolean
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

export type DependencyOptions = {|
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isURL?: boolean,
  loc?: SourceLocation,
  env?: EnvironmentOpts,
  meta?: Meta,
  target?: Target
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
  meta: ?Meta;
  target: ?Target;

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
  hash: ?string;
  filePath: FilePath;
  type: string;
  ast: ?AST;
  dependencies: Map<string, Dependency>;
  connectedFiles: Map<FilePath, File>;
  isIsolated: boolean;
  outputHash: string;
  env: Environment;
  meta: Meta;
  stats: Stats;

  getCode(): Promise<string>;
  getStream(): Readable;
  getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null>;
  getConnectedFiles(): Array<File>;
  getDependencies(): Array<Dependency>;
  getPackage(): Promise<PackageJSON | null>;
  addDependency(dep: DependencyOptions): string;
  createChildAsset(result: TransformerResult): Asset;
  commit(): Promise<void>;
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

export type TransformerResult = {
  type: string,
  code?: string,
  content?: string,
  ast?: ?AST,
  dependencies?: Array<DependencyOptions> | Map<string, DependencyOptions>,
  connectedFiles?: Array<File> | Map<FilePath, File>,
  isIsolated?: boolean,
  env?: EnvironmentOpts,
  meta?: Meta
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
  ) => Async<GenerateOutput>,
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

export interface TraversalActions {
  skipChildren(): void;
  stop(): void;
}

export type GraphTraversalCallback<TNode, TContext> = (
  node: TNode,
  context: ?TContext,
  traversal: TraversalActions
) => ?TContext;

// Not a directly exported interface.
interface AssetGraphLike {
  getDependencies(asset: Asset): Array<Dependency>;
  getDependencyResolution(dependency: Dependency): ?Asset;
  traverseAssets<TContext>(
    visit: GraphTraversalCallback<Asset, TContext>
  ): ?TContext;
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
    visit: GraphTraversalCallback<MainAssetGraphTraversable, TContext>
  ): ?TContext;
}

export interface Bundle extends AssetGraphLike {
  +id: string;
  +type: string;
  +env: Environment;
  +isEntry: ?boolean;
  +target: ?Target;
  +filePath: ?FilePath;
  +stats: Stats;
  getEntryAssets(): Array<Asset>;
  getTotalSize(asset?: Asset): number;
  traverse<TContext>(
    visit: GraphTraversalCallback<BundleTraversable, TContext>
  ): ?TContext;
}

export interface MutableBundle extends Bundle {
  filePath: ?FilePath;
  isEntry: ?boolean;
  stats: Stats;
  merge(Bundle): void;
  removeAsset(Asset): void;
}

export interface NamedBundle extends Bundle {
  +filePath: FilePath;
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
  bundle(
    graph: MainAssetGraph,
    bundleGraph: MutableBundleGraph,
    opts: ParcelOptions
  ): Async<void>
|};

export type NamerOptions = {|
  ...ParcelOptions,
  rootDir: FilePath
|};

export type Namer = {|
  name(
    bundle: Bundle,
    bundleGraph: BundleGraph,
    opts: NamerOptions
  ): Async<?FilePath>
|};

export type RuntimeAsset = {|
  filePath: FilePath,
  code: string,
  dependency?: Dependency
|};

export type Runtime = {|
  apply(
    bundle: NamedBundle,
    bundleGraph: BundleGraph,
    opts: ParcelOptions
  ): Async<void | RuntimeAsset | Array<RuntimeAsset>>
|};

export type Packager = {|
  package(bundle: Bundle, opts: ParcelOptions): Async<Blob>
|};

export type Optimizer = {|
  optimize(bundle: Bundle, contents: Blob, opts: ParcelOptions): Async<Blob>
|};

export type Resolver = {|
  resolve(
    dependency: Dependency,
    opts: ParcelOptions,
    rootDir: string
  ): Async<FilePath | null>
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

type ResolvingProgressEvent = {|
  type: 'buildProgress',
  phase: 'resolving',
  dependency: Dependency
|};

type TransformingProgressEvent = {|
  type: 'buildProgress',
  phase: 'transforming',
  request: TransformerRequest
|};

type TransformFinishedEvent = {|
  type: 'buildProgress',
  phase: 'transformFinished',
  cacheEntry: CacheEntry
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
  | TransformFinishedEvent
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
  | BuildFailureEvent;

export type Reporter = {|
  report(
    event: ReporterEvent,
    opts: ParcelOptions,
    targets: Array<Target>
  ): Async<void>
|};

export interface ErrorWithCode extends Error {
  code?: string;
}

export interface IDisposable {
  dispose(): void;
}
