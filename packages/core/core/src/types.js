// @flow strict-local

import type {
  ASTGenerator,
  BuildMode,
  BundleGroup,
  Engines,
  EnvironmentContext,
  EnvMap,
  FileCreateInvalidation,
  FilePath,
  Glob,
  LogLevel,
  Meta,
  ModuleSpecifier,
  PackageName,
  ReporterEvent,
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
  QueryParameters,
  DetailedReportOptions,
  DevDepOptions,
} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {FileSystem} from '@parcel/fs';
import type Cache from '@parcel/cache';
import type {PackageManager} from '@parcel/package-manager';

export type ParcelPluginNode = {|
  packageName: PackageName,
  resolveFrom: FilePath,
  keyPath?: string,
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
  runtimes?: PureParcelConfigPipeline,
  packagers?: {[Glob]: ParcelPluginNode, ...},
  optimizers?: {[Glob]: ExtendableParcelConfigPipeline, ...},
  reporters?: PureParcelConfigPipeline,
  validators?: {[Glob]: ExtendableParcelConfigPipeline, ...},
  filePath: FilePath,
  resolveFrom?: FilePath,
|};

export type Environment = {|
  id: string,
  context: EnvironmentContext,
  engines: Engines,
  includeNodeModules:
    | boolean
    | Array<PackageName>
    | {[PackageName]: boolean, ...},
  outputFormat: OutputFormat,
  isLibrary: boolean,
  shouldOptimize: boolean,
  shouldScopeHoist: boolean,
  sourceMap: ?TargetSourceMapOptions,
|};

export type Target = {|
  distEntry?: ?FilePath,
  distDir: FilePath,
  env: Environment,
  name: string,
  publicUrl: string,
  loc?: ?SourceLocation,
  pipeline?: string,
  source?: FilePath | Array<FilePath>,
|};

export type Dependency = {|
  id: string,
  moduleSpecifier: ModuleSpecifier,
  isAsync: boolean,
  isEntry: ?boolean,
  isOptional: boolean,
  isURL: boolean,
  isIsolated: boolean,
  loc: ?SourceLocation,
  env: Environment,
  meta: Meta,
  target: ?Target,
  sourceAssetId: ?string,
  sourcePath: ?string,
  resolveFrom: ?string,
  symbols: ?Map<
    Symbol,
    {|local: Symbol, loc: ?SourceLocation, isWeak: boolean, meta?: ?Meta|},
  >,
  pipeline?: ?string,
|};

export type Asset = {|
  id: ContentKey,
  committed: boolean,
  hash: ?string,
  filePath: FilePath,
  query: ?QueryParameters,
  type: string,
  dependencies: Map<string, Dependency>,
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
  symbols: ?Map<Symbol, {|local: Symbol, loc: ?SourceLocation, meta?: ?Meta|}>,
  sideEffects: boolean,
  uniqueKey: ?string,
  configPath?: FilePath,
  plugin: ?PackageName,
  configKeyPath?: string,
|};

export type FileInvalidation = {|
  type: 'file',
  filePath: FilePath,
|};

export type EnvInvalidation = {|
  type: 'env',
  key: string,
|};

export type OptionInvalidation = {|
  type: 'option',
  key: string,
|};

export type RequestInvalidation =
  | FileInvalidation
  | EnvInvalidation
  | OptionInvalidation;

export type DevDepRequest = {|
  moduleSpecifier: ModuleSpecifier,
  resolveFrom: FilePath,
  hash: string,
  invalidateOnFileCreate?: Array<FileCreateInvalidation>,
  invalidateOnFileChange?: Set<FilePath>,
  additionalInvalidations?: Array<{|
    moduleSpecifier: ModuleSpecifier,
    resolveFrom: FilePath,
  |}>,
|};

export type ParcelOptions = {|
  entries: Array<FilePath>,
  entryRoot: FilePath,
  config?: ModuleSpecifier,
  defaultConfig?: ModuleSpecifier,
  env: EnvMap,
  targets: ?(Array<string> | {+[string]: TargetDescriptor, ...}),

  shouldDisableCache: boolean,
  cacheDir: FilePath,
  mode: BuildMode,
  hmrOptions: ?HMROptions,
  shouldContentHash: boolean,
  serveOptions: ServerOptions | false,
  shouldBuildLazily: boolean,
  shouldAutoInstall: boolean,
  logLevel: LogLevel,
  projectRoot: FilePath,
  lockFile: ?FilePath,
  shouldProfile: boolean,
  shouldPatchConsole: boolean,
  detailedReport?: ?DetailedReportOptions,

  inputFS: FileSystem,
  outputFS: FileSystem,
  cache: Cache,
  packageManager: PackageManager,
  additionalReporters: Array<{|
    packageName: ModuleSpecifier,
    resolveFrom: FilePath,
  |}>,

  instanceId: string,

  +defaultTargetOptions: {|
    +shouldOptimize: boolean,
    +shouldScopeHoist: boolean,
    +sourceMaps: boolean,
    +publicUrl: string,
    +distDir?: FilePath,
    +engines?: Engines,
  |},
|};

// forcing NodeId to be opaque as it should only be created once
export opaque type NodeId = number;
export function toNodeId(x: number): NodeId {
  return x;
}
export function fromNodeId(x: NodeId): number {
  return x;
}

export type ContentKey = string;

export type Edge<TEdgeType: string | null> = {|
  from: NodeId,
  to: NodeId,
  type: TEdgeType,
|};

export interface Node {
  id: ContentKey;
  +type: string;
  // $FlowFixMe
  value: any;
}

export type AssetNode = {|
  id: ContentKey,
  +type: 'asset',
  value: Asset,
  usedSymbols: Set<Symbol>,
  hasDeferred?: boolean,
  usedSymbolsDownDirty: boolean,
  usedSymbolsUpDirty: boolean,
  requested?: boolean,
|};

export type DependencyNode = {|
  id: ContentKey,
  type: 'dependency',
  value: Dependency,
  complete?: boolean,
  correspondingRequest?: string,
  deferred: boolean,
  /** dependency was deferred (= no used symbols (in immediate parents) & side-effect free) */
  hasDeferred?: boolean,
  usedSymbolsDown: Set<Symbol>,
  usedSymbolsUp: Set<Symbol>,
  usedSymbolsDownDirty: boolean,
  /** for the "up" pass, the parent asset needs to be updated */
  usedSymbolsUpDirtyUp: boolean,
  /** for the "up" pass, the dependency resolution asset needs to be updated */
  usedSymbolsUpDirtyDown: boolean,
  /** dependency was excluded (= no used symbols (globally) & side-effect free) */
  excluded: boolean,
|};

export type RootNode = {|id: ContentKey, +type: 'root', value: string | null|};

export type AssetRequestInput = {|
  name?: string, // AssetGraph name, needed so that different graphs can isolated requests since the results are not stored
  filePath: FilePath,
  env: Environment,
  isSource?: boolean,
  canDefer?: boolean,
  sideEffects?: boolean,
  code?: string,
  pipeline?: ?string,
  optionsRef: SharedReference,
  isURL?: boolean,
  query?: ?QueryParameters,
|};

export type AssetRequestResult = Array<Asset>;
// Asset group nodes are essentially used as placeholders for the results of an asset request
export type AssetGroup = $Rest<
  AssetRequestInput,
  {|optionsRef: SharedReference|},
>;
export type AssetGroupNode = {|
  id: ContentKey,
  +type: 'asset_group',
  value: AssetGroup,
  correspondingRequest?: string,
  /** this node was deferred (= no used symbols (in immediate parents) & side-effect free) */
  deferred?: boolean,
  hasDeferred?: boolean,
  usedSymbolsDownDirty: boolean,
|};

export type TransformationRequest = {|
  ...AssetGroup,
  invalidations: Array<RequestInvalidation>,
  invalidateReason: number,
  devDeps: Map<PackageName, string>,
  invalidDevDeps: Array<{|
    moduleSpecifier: ModuleSpecifier,
    resolveFrom: FilePath,
  |}>,
|};

export type DepPathRequestNode = {|
  id: ContentKey,
  +type: 'dep_path_request',
  value: Dependency,
|};

export type AssetRequestNode = {|
  id: ContentKey,
  +type: 'asset_request',
  value: AssetRequestInput,
|};

export type EntrySpecifierNode = {|
  id: ContentKey,
  +type: 'entry_specifier',
  value: ModuleSpecifier,
  correspondingRequest?: string,
|};

export type Entry = {|
  filePath: FilePath,
  packagePath: FilePath,
  target?: string,
|};

export type EntryFileNode = {|
  id: ContentKey,
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

export type Config = {|
  id: string,
  isSource: boolean,
  searchPath: FilePath,
  env: Environment,
  resultHash: ?string,
  result: ConfigResult,
  includedFiles: Set<FilePath>,
  invalidateOnFileCreate: Array<FileCreateInvalidation>,
  invalidateOnOptionChange: Set<string>,
  devDeps: Array<DevDepOptions>,
  shouldInvalidateOnStartup: boolean,
|};

export type DepVersionRequestNode = {|
  id: ContentKey,
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
  id: ContentKey,
  +type: 'entry_request',
  value: string,
|};

export type TargetRequestNode = {|
  id: ContentKey,
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
  id: ContentKey,
  publicId: ?string,
  hashReference: string,
  type: string,
  env: Environment,
  entryAssetIds: Array<ContentKey>,
  mainEntryId: ?ContentKey,
  isEntry: ?boolean,
  isInline: ?boolean,
  isSplittable: ?boolean,
  isPlaceholder?: boolean,
  target: Target,
  filePath: ?FilePath,
  name: ?string,
  displayName: ?string,
  pipeline: ?string,
  stats: Stats,
|};

export type BundleNode = {|
  id: ContentKey,
  +type: 'bundle',
  value: Bundle,
|};

export type BundleGroupNode = {|
  id: ContentKey,
  +type: 'bundle_group',
  value: BundleGroup,
|};

export type TransformationOpts = {|
  request: AssetGroup,
  optionsRef: SharedReference,
  configCachePath: string,
|};

export type ValidationOpts = {|
  requests: AssetGroup[],
  optionsRef: SharedReference,
  configCachePath: string,
|};

export type ReportFn = (event: ReporterEvent) => void;
