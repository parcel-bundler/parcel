// @flow strict-local

import type {
  ASTGenerator,
  BuildMode,
  BundleGroup,
  Engines,
  EnvironmentContext,
  EnvMap,
  File,
  FilePath,
  Glob,
  JSONObject,
  LogLevel,
  Meta,
  ModuleSpecifier,
  PackageName,
  PackageJSON,
  ReporterEvent,
  ResolvedParcelConfigFile,
  Semver,
  ServerOptions,
  SourceLocation,
  Stats,
  Symbol,
  TargetSourceMapOptions,
  ConfigResult,
  OutputFormat,
  TargetDescriptor,
  HMROptions,
} from '@parcel/types';

import type {FileSystem} from '@parcel/fs';
import type Cache from '@parcel/cache';
import type {PackageManager} from '@parcel/package-manager';

export type ParcelPluginNode = {|
  packageName: PackageName,
  resolveFrom: FilePath,
|};

export type PureParcelConfigPipeline = $ReadOnlyArray<ParcelPluginNode>;
export type ExtendableParcelConfigPipeline = $ReadOnlyArray<
  ParcelPluginNode | '...',
>;

export type ProcessedParcelConfig = {|
  extends?: PackageName | FilePath | Array<PackageName | FilePath>,
  resolvers?: PureParcelConfigPipeline,
  transformers?: {[Glob]: ExtendableParcelConfigPipeline, ...},
  bundler: ?ParcelPluginNode,
  namers?: PureParcelConfigPipeline,
  runtimes?: {[EnvironmentContext]: PureParcelConfigPipeline, ...},
  packagers?: {[Glob]: ParcelPluginNode, ...},
  optimizers?: {[Glob]: ExtendableParcelConfigPipeline, ...},
  reporters?: PureParcelConfigPipeline,
  validators?: {[Glob]: ExtendableParcelConfigPipeline, ...},
  filePath: FilePath,
  resolveFrom?: FilePath,
|};

export type Environment = {|
  context: EnvironmentContext,
  engines: Engines,
  includeNodeModules:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...},
  outputFormat: OutputFormat,
  isLibrary: boolean,
  minify: boolean,
  scopeHoist: boolean,
|};

export type Target = {|
  distEntry?: ?FilePath,
  distDir: FilePath,
  env: Environment,
  sourceMap?: TargetSourceMapOptions,
  name: string,
  publicUrl: string,
  loc?: ?SourceLocation,
|};

export type Dependency = {|
  id: string,
  moduleSpecifier: ModuleSpecifier,
  isAsync: boolean,
  isEntry: boolean,
  isOptional: boolean,
  isURL: boolean,
  isWeak: ?boolean,
  loc: ?SourceLocation,
  env: Environment,
  meta: Meta,
  target: ?Target,
  sourceAssetId: ?string,
  sourcePath: ?string,
  symbols: Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
  pipeline?: ?string,
|};

export type Asset = {|
  id: string,
  committed: boolean,
  hash: ?string,
  filePath: FilePath,
  type: string,
  dependencies: Map<string, Dependency>,
  includedFiles: Map<FilePath, File>,
  isIsolated: boolean,
  isInline: boolean,
  isSplittable: ?boolean,
  isSource: boolean,
  env: Environment,
  meta: Meta,
  stats: Stats,
  contentKey: ?string,
  mapKey: ?string,
  outputHash: ?string,
  pipeline: ?string,
  astKey: ?string,
  astGenerator: ?ASTGenerator,
  symbols: ?Map<Symbol, {|local: Symbol, loc: ?SourceLocation|}>,
  sideEffects: boolean,
  uniqueKey: ?string,
  configPath?: FilePath,
  plugin: ?PackageName,
|};

export type ParcelOptions = {|
  entries: Array<FilePath>,
  rootDir: FilePath,
  config?: ResolvedParcelConfigFile,
  defaultConfig?: ResolvedParcelConfigFile,
  env: EnvMap,
  targets: ?(Array<string> | {+[string]: TargetDescriptor, ...}),
  defaultEngines?: Engines,

  disableCache: boolean,
  cacheDir: FilePath,
  killWorkers?: boolean,
  mode: BuildMode,
  minify: boolean,
  scopeHoist: boolean,
  sourceMaps: boolean,
  publicUrl: string,
  distDir: ?FilePath,
  hot: ?HMROptions,
  contentHash: boolean,
  serve: ServerOptions | false,
  autoinstall: boolean,
  logLevel: LogLevel,
  projectRoot: FilePath,
  lockFile: ?FilePath,
  profile: boolean,
  patchConsole: boolean,
  detailedReport?: number,

  inputFS: FileSystem,
  outputFS: FileSystem,
  cache: Cache,
  packageManager: PackageManager,

  instanceId: string,
|};

export type NodeId = string;

export type Edge<TEdgeType: string | null> = {|
  from: NodeId,
  to: NodeId,
  type: TEdgeType,
|};

export interface Node {
  id: string;
  +type?: string;
  // $FlowFixMe
  value: any;
}

export type AssetNode = {|
  id: string,
  +type: 'asset',
  value: Asset,
  hasDeferred?: boolean,
|};

export type DependencyNode = {|
  id: string,
  type: 'dependency',
  value: Dependency,
  complete?: boolean,
  correspondingRequest?: string,
  hasDeferred?: boolean,
|};

export type RootNode = {|id: string, +type: 'root', value: string | null|};

export type AssetRequestDesc = {|
  filePath: FilePath,
  env: Environment,
  isSource?: boolean,
  sideEffects?: boolean,
  code?: string,
  pipeline?: ?string,
|};

export type AssetRequestResult = {|
  assets: Array<Asset>,
  configRequests: Array<{|request: ConfigRequestDesc, result: Config|}>,
|};
// Asset group nodes are essentially used as placeholders for the results of an asset request
export type AssetGroup = AssetRequestDesc;
export type AssetGroupNode = {|
  id: string,
  +type: 'asset_group',
  value: AssetGroup,
  deferred?: boolean,
  correspondingRequest?: string,
  hasDeferred?: boolean,
|};

export type DepPathRequestNode = {|
  id: string,
  +type: 'dep_path_request',
  value: Dependency,
|};

export type AssetRequestNode = {|
  id: string,
  +type: 'asset_request',
  value: AssetRequestDesc,
|};

export type EntrySpecifierNode = {|
  id: string,
  +type: 'entry_specifier',
  value: ModuleSpecifier,
  correspondingRequest?: string,
|};

export type Entry = {|
  filePath: FilePath,
  packagePath: FilePath,
|};

export type EntryFileNode = {|
  id: string,
  +type: 'entry_file',
  value: Entry,
  correspondingRequest?: string,
|};

export type AssetGraphNode =
  | AssetGroupNode
  | AssetNode
  | DependencyNode
  | EntrySpecifierNode
  | EntryFileNode
  | RootNode;

export type BundleGraphNode =
  | AssetNode
  | DependencyNode
  | EntrySpecifierNode
  | EntryFileNode
  | RootNode
  | BundleGroupNode
  | BundleNode;

export type ConfigRequestNode = {|
  id: string,
  +type: 'config_request',
  value: ConfigRequestDesc,
|};

export type Config = {|
  isSource: boolean,
  searchPath: FilePath,
  env: Environment,
  resultHash: ?string,
  result: ConfigResult,
  includedFiles: Set<FilePath>,
  pkg: ?PackageJSON,
  pkgFilePath: ?FilePath,
  watchGlob: ?Glob,
  devDeps: Map<PackageName, ?string>,
  shouldRehydrate: boolean,
  shouldReload: boolean,
  shouldInvalidateOnStartup: boolean,
|};

export type ConfigRequestDesc = {|
  filePath: FilePath,
  env: Environment,
  isSource: boolean,
  pipeline?: ?string,
  plugin?: PackageName,
  meta: JSONObject,
|};

export type DepVersionRequestNode = {|
  id: string,
  +type: 'dep_version_request',
  value: DepVersionRequestDesc,
|};

export type DepVersionRequestDesc = {|
  moduleSpecifier: PackageName,
  resolveFrom: FilePath,
  result?: Semver,
|};

export type EntryRequest = {|
  specifier: ModuleSpecifier,
  result?: FilePath,
|};

export type EntryRequestNode = {|
  id: string,
  +type: 'entry_request',
  value: string,
|};

export type TargetRequestNode = {|
  id: string,
  +type: 'target_request',
  value: FilePath,
|};

export type CacheEntry = {|
  filePath: FilePath,
  env: Environment,
  hash: string,
  assets: Array<Asset>,
  // Initial assets, pre-post processing
  initialAssets: ?Array<Asset>,
|};

export type Bundle = {|
  id: string,
  hashReference: string,
  type: string,
  env: Environment,
  entryAssetIds: Array<string>,
  isEntry: ?boolean,
  isInline: ?boolean,
  isSplittable: ?boolean,
  target: Target,
  filePath: ?FilePath,
  name: ?string,
  displayName: ?string,
  pipeline: ?string,
  stats: Stats,
|};

export type BundleNode = {|
  id: string,
  +type: 'bundle',
  value: Bundle,
|};

export type BundleGroupNode = {|
  id: string,
  +type: 'bundle_group',
  value: BundleGroup,
|};

export type TransformationOpts = {|
  request: AssetRequestDesc,
  optionsRef: number,
  configRef: number,
|};

export type ValidationOpts = {|
  requests: AssetRequestDesc[],
  optionsRef: number,
  configRef: number,
|};

export type ReportFn = (event: ReporterEvent) => void;
