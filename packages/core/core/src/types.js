// @flow strict-local

import type {
  ASTGenerator,
  BuildMode,
  BundleGroup,
  Engines,
  EnvironmentContext,
  EnvMap,
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
} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {FileSystem} from '@parcel/fs';
import type Cache from '@parcel/cache';
import type {PackageManager} from '@parcel/package-manager';
import type {ProjectPath} from './projectPath';

export type ParcelPluginNode = {|
  packageName: PackageName,
  resolveFrom: ProjectPath,
  keyPath?: string,
|};

export type PureParcelConfigPipeline = $ReadOnlyArray<ParcelPluginNode>;
export type ExtendableParcelConfigPipeline = $ReadOnlyArray<
  ParcelPluginNode | '...',
>;

export type ProcessedParcelConfig = {|
  // TODO ProjectPath?
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
  filePath: ProjectPath,
  resolveFrom?: ProjectPath,
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
  distDir: ProjectPath,
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
  sourcePath: ?ProjectPath,
  resolveFrom: ?ProjectPath,
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
  filePath: ProjectPath,
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
  configPath?: ProjectPath,
  plugin: ?PackageName,
  configKeyPath?: string,
|};

export type InternalGlob = ProjectPath;

export type InternalFile = {|
  +filePath: ProjectPath,
  +hash?: string,
|};

export type FileInvalidation = {|
  type: 'file',
  filePath: ProjectPath,
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

export type InternalFileInvalidation = {|
  filePath: ProjectPath,
|};

export type InternalGlobInvalidation = {|
  glob: InternalGlob,
|};

export type InternalFileAboveInvalidation = {|
  fileName: string,
  aboveFilePath: ProjectPath,
|};

export type InternalFileCreateInvalidation =
  | InternalFileInvalidation
  | InternalGlobInvalidation
  | InternalFileAboveInvalidation;

export type DevDepRequest = {|
  moduleSpecifier: ModuleSpecifier,
  resolveFrom: ProjectPath,
  hash: string,
  invalidateOnFileCreate?: Array<InternalFileCreateInvalidation>,
  invalidateOnFileChange?: Set<ProjectPath>,
  additionalInvalidations?: Array<{|
    moduleSpecifier: ModuleSpecifier,
    resolveFrom: ProjectPath,
  |}>,
|};

export type ParcelOptions = {|
  entries: Array<ProjectPath>,
  entryRoot: ProjectPath,
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
  shouldProfile: boolean,
  shouldPatchConsole: boolean,
  detailedReport?: ?DetailedReportOptions,

  inputFS: FileSystem,
  outputFS: FileSystem,
  cache: Cache,
  packageManager: PackageManager,
  additionalReporters: Array<{|
    packageName: ModuleSpecifier,
    resolveFrom: ProjectPath,
  |}>,

  instanceId: string,

  +defaultTargetOptions: {|
    +shouldOptimize: boolean,
    +shouldScopeHoist: boolean,
    +sourceMaps: boolean,
    +publicUrl: string,
    +distDir?: ProjectPath,
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
  filePath: ProjectPath,
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
    resolveFrom: ProjectPath,
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
  value: ProjectPath,
  correspondingRequest?: string,
|};

export type Entry = {|
  filePath: ProjectPath,
  packagePath: ProjectPath,
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

export type InternalDevDepOptions = {|
  moduleSpecifier: ModuleSpecifier,
  resolveFrom: ProjectPath,
  invalidateParcelPlugin?: boolean,
|};

export type Config = {|
  id: string,
  isSource: boolean,
  searchPath: ProjectPath,
  env: Environment,
  resultHash: ?string,
  result: ConfigResult,
  includedFiles: Set<ProjectPath>,
  invalidateOnFileCreate: Array<InternalFileCreateInvalidation>,
  invalidateOnOptionChange: Set<string>,
  devDeps: Array<InternalDevDepOptions>,
  shouldInvalidateOnStartup: boolean,
|};

export type DepVersionRequestNode = {|
  id: ContentKey,
  +type: 'dep_version_request',
  value: DepVersionRequestDesc,
|};

export type DepVersionRequestDesc = {|
  moduleSpecifier: PackageName,
  resolveFrom: ProjectPath,
  result?: Semver,
|};

export type EntryRequest = {|
  specifier: ModuleSpecifier,
  result?: ProjectPath,
|};

export type EntryRequestNode = {|
  id: ContentKey,
  +type: 'entry_request',
  value: string,
|};

export type TargetRequestNode = {|
  id: ContentKey,
  +type: 'target_request',
  value: ProjectPath,
|};

export type CacheEntry = {|
  filePath: ProjectPath,
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
  filePath: ?ProjectPath,
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
