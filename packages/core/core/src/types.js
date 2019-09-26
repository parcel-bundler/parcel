// @flow strict-local

import type {
  BuildMode,
  BundleGroup,
  Engines,
  EnvironmentContext,
  File,
  FilePath,
  Glob,
  LogLevel,
  Meta,
  ModuleSpecifier,
  PackageName,
  PackageJSON,
  ResolvedParcelConfigFile,
  Semver,
  ServerOptions,
  SourceLocation,
  Stats,
  Symbol,
  TargetSourceMapOptions,
  ConfigResult,
  OutputFormat,
  TargetDescriptor
} from '@parcel/types';

import type {FileSystem} from '@parcel/fs';
import type Cache from '@parcel/cache';
import type {PackageManager} from '@parcel/package-manager';

export type Environment = {|
  context: EnvironmentContext,
  engines: Engines,
  includeNodeModules: boolean | Array<PackageName>,
  outputFormat: OutputFormat,
  isLibrary: boolean
|};

export type Target = {|
  distEntry?: ?FilePath,
  distDir: FilePath,
  env: Environment,
  sourceMap?: TargetSourceMapOptions,
  name: string,
  publicUrl: ?string
|};

export type Dependency = {|
  id: string,
  moduleSpecifier: ModuleSpecifier,
  isAsync: boolean,
  isEntry: boolean,
  isOptional: boolean,
  isURL: boolean,
  isWeak: boolean,
  loc: ?SourceLocation,
  env: Environment,
  meta: Meta,
  target: ?Target,
  sourceAssetId: ?string,
  sourcePath: ?string,
  symbols: Map<Symbol, Symbol>
|};

export type Asset = {|
  id: string,
  hash: ?string,
  filePath: FilePath,
  type: string,
  dependencies: Map<string, Dependency>,
  includedFiles: Map<FilePath, File>,
  isIsolated: boolean,
  isInline: boolean,
  outputHash: string,
  env: Environment,
  meta: Meta,
  stats: Stats,
  contentKey: ?string,
  mapKey: ?string,
  symbols: Map<Symbol, Symbol>,
  sideEffects: boolean,
  uniqueKey?: ?string
|};

export type ParcelOptions = {|
  entries: Array<FilePath>,
  rootDir: FilePath,
  config?: ResolvedParcelConfigFile,
  defaultConfig?: ResolvedParcelConfigFile,
  env: {+[string]: string, ...},
  targets: ?(Array<string> | {+[string]: TargetDescriptor, ...}),
  defaultEngines?: Engines,

  disableCache: boolean,
  cacheDir: FilePath,
  killWorkers?: boolean,
  mode: BuildMode,
  minify: boolean,
  scopeHoist: boolean,
  sourceMaps: boolean,
  hot: ServerOptions | false,
  serve: ServerOptions | false,
  autoinstall: boolean,
  logLevel: LogLevel,
  projectRoot: FilePath,
  lockFile: ?FilePath,
  profile: boolean,
  patchConsole: ?boolean,

  inputFS: FileSystem,
  outputFS: FileSystem,
  cache: Cache,
  packageManager: PackageManager
|};

export type NodeId = string;

export type Edge<TEdgeType: string | null> = {|
  from: NodeId,
  to: NodeId,
  type: TEdgeType
|};

export interface Node {
  id: string;
  +type?: string;
  // $FlowFixMe
  value: any;
}

export type AssetNode = {|id: string, +type: 'asset', value: Asset|};

export type DependencyNode = {|
  id: string,
  type: 'dependency',
  value: Dependency
|};

export type FileNode = {|id: string, +type: 'file', value: File|};
export type GlobNode = {|id: string, +type: 'glob', value: Glob|};
export type RootNode = {|id: string, +type: 'root', value: string | null|};

export type AssetRequest = {|
  filePath: FilePath,
  env: Environment,
  sideEffects?: boolean,
  code?: string
|};

// Asset group nodes are essentially used as placeholders for the results of an asset request
export type AssetGroup = AssetRequest;
export type AssetGroupNode = {|
  id: string,
  +type: 'asset_group',
  // An asset group node is used to
  value: AssetGroup
|};

export type DepPathRequestNode = {|
  id: string,
  +type: 'dep_path_request',
  value: Dependency
|};

export type AssetRequestNode = {|
  id: string,
  +type: 'asset_request',
  value: AssetRequest
|};

export type EntrySpecifierNode = {|
  id: string,
  +type: 'entry_specifier',
  value: ModuleSpecifier
|};

export type EntryFileNode = {|
  id: string,
  +type: 'entry_file',
  value: ModuleSpecifier
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
  value: ConfigRequest
|};

export type Config = {|
  searchPath: FilePath,
  env: Environment,
  resolvedPath: ?FilePath,
  resultHash: ?string,
  result: ConfigResult,
  includedFiles: Set<FilePath>,
  pkg: ?PackageJSON,
  watchGlob: ?Glob,
  devDeps: Map<PackageName, ?string>,
  shouldRehydrate: boolean,
  shouldReload: boolean,
  shouldInvalidateOnStartup: boolean
|};

export type ConfigRequest = {|
  filePath: FilePath,
  env: Environment,
  plugin?: PackageName,
  //$FlowFixMe will lock this down more in a future commit
  meta: any,
  result?: Config
|};

export type DepVersionRequestNode = {|
  id: string,
  +type: 'dep_version_request',
  value: DepVersionRequest
|};

export type DepVersionRequest = {|
  moduleSpecifier: PackageName,
  resolveFrom: FilePath,
  result?: Semver
|};

export type EntryRequest = {|
  specifier: ModuleSpecifier,
  result?: FilePath
|};

export type EntryRequestNode = {|
  id: string,
  +type: 'entry_request',
  value: string
|};

export type TargetRequestNode = {|
  id: string,
  +type: 'target_request',
  value: FilePath
|};

export type RequestGraphNode = RequestNode | FileNode | GlobNode;
export type RequestNode =
  | EntryRequestNode
  | TargetRequestNode
  | DepPathRequestNode
  | AssetRequestNode
  | ConfigRequestNode
  | DepVersionRequestNode;
export type SubRequestNode = ConfigRequestNode | DepVersionRequestNode;

export type CacheEntry = {
  filePath: FilePath,
  env: Environment,
  hash: string,
  assets: Array<Asset>,
  // Initial assets, pre-post processing
  initialAssets: ?Array<Asset>,
  ...
};

export type Bundle = {|
  id: string,
  type: string,
  env: Environment,
  entryAssetIds: Array<string>,
  isEntry: ?boolean,
  isInline: ?boolean,
  target: Target,
  filePath: ?FilePath,
  name: ?string,
  stats: Stats
|};

export type BundleNode = {|
  id: string,
  +type: 'bundle',
  value: Bundle
|};

export type BundleGroupNode = {|
  id: string,
  +type: 'bundle_group',
  value: BundleGroup
|};

export type TransformationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};

export type ValidationOpts = {|
  request: AssetRequest,
  loadConfig: (ConfigRequest, NodeId) => Promise<Config>,
  parentNodeId: NodeId,
  options: ParcelOptions
|};
