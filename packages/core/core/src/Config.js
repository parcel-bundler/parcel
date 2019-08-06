// @flow strict-local
import type {
  Environment,
  FilePath,
  Glob,
  PackageJSON,
  PackageName,
  ParcelOptions,
  ThirdPartyConfig
} from '@parcel/types';

type ConfigOpts = {|
  searchPath: FilePath,
  env: Environment,
  options: ParcelOptions,
  resolvedPath?: FilePath,
  result?: ThirdPartyConfig,
  includedFiles?: Set<FilePath>,
  watchGlob?: Glob,
  devDeps?: Map<PackageName, ?string>,
  shouldRehydrate?: boolean,
  shouldReload?: boolean,
  shouldInvalidateOnStartup?: boolean
|};

export default class Config {
  searchPath: FilePath;
  env: Environment;
  options: ParcelOptions;
  resolvedPath: ?FilePath;
  result: ?ThirdPartyConfig;
  resultHash: ?string;
  includedFiles: Set<FilePath>;
  watchGlob: ?Glob;
  devDeps: Map<PackageName, ?string>;
  pkg: ?PackageJSON;
  shouldRehydrate: ?boolean;
  shouldReload: ?boolean;
  shouldInvalidateOnStartup: ?boolean;

  constructor({
    searchPath,
    env,
    options,
    resolvedPath,
    result,
    includedFiles,
    watchGlob,
    devDeps,
    shouldRehydrate,
    shouldReload,
    shouldInvalidateOnStartup
  }: ConfigOpts) {
    this.searchPath = searchPath;
    this.env = env;
    this.options = options;
    this.resolvedPath = resolvedPath;
    this.result = result || null;
    this.includedFiles = includedFiles || new Set();
    this.watchGlob = watchGlob;
    this.devDeps = devDeps || new Map();
    this.shouldRehydrate = shouldRehydrate;
    this.shouldReload = shouldReload;
    this.shouldInvalidateOnStartup = shouldInvalidateOnStartup;
  }

  addDevDependency(name: PackageName, version?: string) {
    this.devDeps.set(name, version);
  }

  // TODO: start using edge types for more flexible invalidations
  getInvalidations() {
    let invalidations = [];

    if (this.watchGlob != null) {
      invalidations.push({
        action: 'add',
        pattern: this.watchGlob
      });
    }

    for (let filePath of [this.resolvedPath, ...this.includedFiles]) {
      invalidations.push({
        action: 'change',
        pattern: filePath
      });

      invalidations.push({
        action: 'unlink',
        pattern: filePath
      });
    }

    return invalidations;
  }
}
