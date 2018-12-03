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
type ModuleSpecifier = string;

export type ParcelConfig = {
  extends: Array<PackageName | FilePath>,
  resolvers: Array<PackageName>,
  transforms: {
    [Glob]: Array<PackageName>
  },
  loaders: {
    [Glob]: PackageName
  },
  bundler: PackageName,
  namers: Array<PackageName>,
  packagers: {
    [Glob]: PackageName
  },
  optimizers: {
    [Glob]: Array<PackageName>
  },
  reporters: Array<PackageName>
};

export type Engines = {
  node?: SemverRange,
  electron?: SemverRange,
  browsers?: Array<string>
};

export type Target = {
  distPath: FilePath,
  env: Environment
};

export type Environment = {
  context: 'browser' | 'web-worker' | 'service-worker' | 'node' | 'electron',
  engines: Engines,
  includeNodeModules?: boolean
};

type PackageDependencies = {
  [PackageName]: Semver
};

export type PackageJSON = {
  name: PackageName,
  version: Semver,
  main?: FilePath,
  module?: FilePath,
  browser?: FilePath | {[FilePath]: FilePath},
  source?: FilePath | {[FilePath]: FilePath},
  alias?: {
    [PackageName | FilePath | Glob]: PackageName | FilePath
  },
  browserslist?: Array<string>,
  engines?: Engines,
  targets?: {
    [string]: Environment
  },
  dependencies?: PackageDependencies,
  devDependencies?: PackageDependencies,
  peerDependencies?: PackageDependencies
};

export type CLIOptions = {
  cacheDir?: FilePath,
  watch?: boolean,
  distDir?: FilePath
};

export type SourceLocation = {
  filePath: string,
  start: {line: number, column: number},
  end: {line: number, column: number}
};

export type DependencyOptions = {
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  loc?: SourceLocation,
  env?: Environment,
  meta?: JSONObject
};

export type Dependency = {
  ...DependencyOptions,
  id: string,
  env: Environment,

  // TODO: get these from graph instead of storing them on dependencies
  sourcePath: FilePath,
  resolvedPath?: FilePath
};

export type File = {
  filePath: FilePath,
  hash?: string
};

export type TransformerRequest = {
  filePath: FilePath,
  env: Environment
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
  env: Environment;
  meta: JSONObject;

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null>;
  getPackage(): Promise<PackageJSON | null>;
  addDependency(dep: DependencyOptions): string;
  createChildAsset(result: TransformerResult): Asset;
}

export type AssetOutput = {
  code: string,
  map?: SourceMap,
  [string]: Blob
};

export type AST = {
  type: string,
  version: string,
  program: any
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
  env?: Environment,
  meta?: JSONObject
};

type Async<T> = T | Promise<T>;

export type Transformer = {
  getConfig?: (asset: Asset, opts: CLIOptions) => Async<Config | void>,
  canReuseAST?: (ast: AST, opts: CLIOptions) => boolean,
  parse?: (asset: Asset, config: ?Config, opts: CLIOptions) => Async<?AST>,
  transform(
    asset: Asset,
    config: ?Config,
    opts: CLIOptions
  ): Async<Array<TransformerResult | Asset>>,
  generate?: (
    asset: Asset,
    config: ?Config,
    opts: CLIOptions
  ) => Async<AssetOutput>,
  postProcess?: (
    assets: Array<Asset>,
    config: ?Config,
    opts: CLIOptions
  ) => Async<Array<TransformerResult>>
};

export type CacheEntry = {
  filePath: FilePath,
  env: Environment,
  hash: string,
  assets: Array<Asset>,
  initialAssets: ?Array<Asset> // Initial assets, pre-post processing
};

// TODO: what do we want to expose here?
interface AssetGraph {
  filterAssets((asset: Asset) => boolean): AssetGraph;
}

export type Bundle = {
  type: string,
  assets: Array<Asset>,
  filePath?: FilePath
};

export type Bundler = {
  bundle(graph: AssetGraph, opts: CLIOptions): Array<Bundle>
};

export type Namer = {
  name(bundle: Bundle, opts: CLIOptions): Async<FilePath>
};

export type Packager = {
  package(bundle: Bundle, opts: CLIOptions): Async<Blob>
};

export type Optimizer = {
  optimize(bundle: Bundle, contents: Blob, opts: CLIOptions): Async<Blob>
};

export type Resolver = {
  resolve(
    dependency: Dependency,
    opts: CLIOptions,
    rootDir: string
  ): FilePath | null
};

export type Reporter = {
  report(bundles: Array<Bundle>, opts: CLIOptions): void
};
