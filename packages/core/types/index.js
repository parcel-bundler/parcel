// @flow strict-local

import type {AST as _AST, Config as _Config, Node as _Node} from './unsafe';

export type AST = _AST;
export type Config = _Config;
export type Node = _Node;

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
  globals?: Map<string, Asset>,
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

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null>;
  getPackage(): Promise<PackageJSON | null>;
  addDependency(dep: DependencyOptions): string;
  createChildAsset(result: TransformerResult): Asset;
  getOutput(): Promise<AssetOutput>;
}

export type Stats = {|
  time: number,
  size: number
|};

export type AssetOutput = {|
  code: string,
  map?: SourceMap,
  [string]: Blob | JSONValue
|};

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

export interface TraversalActions {
  skipChildren(): void;
  stop(): void;
}

export type GraphTraversalCallback<TNode, TContext> = (
  node: TNode,
  context: ?TContext,
  traversal: TraversalActions
) => ?TContext;

export type NodeId = string;

export type AssetNode = {|id: string, type: 'asset', value: Asset|};
export type AssetReferenceNode = {|
  id: string,
  type: 'asset_reference',
  value: Asset
|};

export type BundleNode = {|
  id: string,
  type: 'bundle',
  value: Bundle
|};

export type BundleGroupNode = {|
  id: string,
  type: 'bundle_group',
  value: BundleGroup
|};

export type DependencyNode = {|
  id: string,
  type: 'dependency',
  value: Dependency
|};

export type FileNode = {|id: string, type: 'file', value: File|};
export type RootNode = {|id: string, type: 'root', value: string | null|};

export type TransformerRequestNode = {|
  id: string,
  type: 'transformer_request',
  value: TransformerRequest
|};

export type BundleGroup = {
  dependency: Dependency,
  target: ?Target,
  entryAssetId: string
};

export type Bundle = {|
  id: string,
  type: string,
  assetGraph: AssetGraph,
  env: Environment,
  isEntry?: boolean,
  target?: Target,
  filePath?: FilePath,
  stats: Stats
|};

export type AssetGraphNode =
  | AssetNode
  | AssetReferenceNode
  | DependencyNode
  | FileNode
  | RootNode
  | TransformerRequestNode
  // Bundle graphs are merged into asset graphs during the bundling phase
  | BundleGraphNode;

export type BundleGraphNode = BundleNode | BundleGroupNode | RootNode;

export type Edge = {|
  from: NodeId,
  to: NodeId
|};

export type GraphUpdates<TNode> = {|
  added: Graph<TNode>,
  removed: Graph<TNode>
|};

export interface Graph<TNode: Node> {
  edges: Set<Edge>;
  nodes: Map<string, TNode>;
  addEdge(edge: Edge): Edge;
  addNode(node: TNode): TNode;
  getNode(id: string): ?TNode;
  getNodesConnectedFrom(node: TNode): Array<TNode>;
  getRootNode(): ?TNode;
  hasNode(id: string): boolean;
  merge(graph: Graph<TNode>): void;
  replaceNodesConnectedTo(
    fromNode: TNode,
    toNodes: Array<TNode>
  ): GraphUpdates<TNode>;
  traverse<TContext>(
    visit: GraphTraversalCallback<TNode, TContext>,
    startNode: ?TNode
  ): ?TContext;
}

// TODO: what do we want to expose here?
export interface AssetGraph extends Graph<AssetGraphNode> {
  createBundle(asset: Asset): Bundle;
  getDependencies(asset: Asset): Array<Dependency>;
  getDependencyResolution(dependency: Dependency): ?Asset;
  getEntryAssets(): Array<Asset>;
  getTotalSize(asset?: Asset): number;
  removeAsset(asset: Asset): void;
  traverseAssets(
    visit: GraphTraversalCallback<Asset, AssetGraphNode>
  ): ?AssetGraphNode;
}

export interface BundleGraph extends Graph<BundleGraphNode> {
  addBundle(bundleGroup: BundleGroup, bundle: Bundle): void;
  addBundleGroup(parentBundle: ?Bundle, bundleGroup: BundleGroup): void;
  findBundlesWithAsset(asset: Asset): Array<Bundle>;
  getBundleGroups(bundle: Bundle): Array<BundleGroup>;
  getBundles(bundleGroup: BundleGroup): Array<Bundle>;
  isAssetInAncestorBundle(bundle: Bundle, asset: Asset): boolean;
  traverseBundles<TContext>(
    visit: GraphTraversalCallback<Bundle, TContext>
  ): ?TContext;
}

export type Bundler = {|
  bundle(
    graph: AssetGraph,
    bundleGraph: BundleGraph,
    opts: ParcelOptions
  ): Async<void>
|};

export type Namer = {|
  name(bundle: Bundle, opts: ParcelOptions): Async<?FilePath>
|};

export type Runtime = {|
  apply(bundle: Bundle, opts: ParcelOptions): Async<void>
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
  bundle: Bundle
|};

type OptimizingProgressEvent = {|
  type: 'buildProgress',
  phase: 'optimizing',
  bundle: Bundle
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
  assetGraph: AssetGraph,
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
  report(event: ReporterEvent, opts: ParcelOptions): Async<void>
|};

export interface ErrorWithCode extends Error {
  code?: string;
}

export interface IDisposable {
  dispose(): void;
}
