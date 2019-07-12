// @flow strict-local
import path from 'path';

import type {
  IConfig,
  Environment,
  FilePath,
  Glob,
  PackageJSON,
  PackageName,
  ParcelOptions,
  ThirdPartyConfig
} from '@parcel/types';
import {loadConfig} from '@parcel/utils';

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

type ConfigOpts = {|
  searchPath: FilePath,
  env: Environment,
  options: ParcelOptions,
  resolvedPath?: FilePath,
  // $FlowFixMe
  result?: any,
  includedFiles?: Set<FilePath>,
  watchGlob?: Glob,
  devDeps?: Map<PackageName, ?string>,
  rehydrate?: boolean,
  reload?: boolean
|};

export default class Config implements IConfig {
  searchPath: FilePath;
  env: Environment;
  options: ParcelOptions;
  resolvedPath: ?FilePath;
  // $FlowFixMe
  result: ?any;
  resultHash: ?string;
  includedFiles: Set<FilePath>;
  watchGlob: ?Glob;
  devDeps: Map<PackageName, ?string>;
  pkg: ?PackageJSON;
  rehydrate: ?boolean;
  reload: ?boolean;

  constructor({
    searchPath,
    env,
    options,
    resolvedPath,
    result,
    includedFiles,
    watchGlob,
    devDeps,
    rehydrate,
    reload
  }: ConfigOpts) {
    this.searchPath = searchPath;
    this.env = env;
    this.options = options;
    this.resolvedPath = resolvedPath;
    this.result = result || null;
    this.includedFiles = includedFiles || new Set();
    this.watchGlob = watchGlob;
    this.devDeps = devDeps || new Map();
    this.rehydrate = rehydrate;
    this.reload = reload;
  }

  setResolvedPath(filePath: FilePath) {
    this.resolvedPath = filePath;
  }

  // $FlowFixMe
  setResult(result: any) {
    this.result = result;
  }

  setResultHash(resultHash: string) {
    this.resultHash = resultHash;
  }

  addIncludedFile(filePath: FilePath) {
    this.includedFiles.add(filePath);
  }

  setDevDep(name: PackageName, version?: string) {
    this.devDeps.set(name, version);
  }

  setWatchGlob(glob: string) {
    this.watchGlob = glob;
  }

  shouldRehydrate() {
    this.rehydrate = true;
  }

  shouldReload() {
    this.reload = true;
  }

  // This will be more useful when we have edge types
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

  async getConfigFrom(
    searchPath: FilePath,
    filePaths: Array<FilePath>,
    options: ?{parse?: boolean}
  ): Promise<ThirdPartyConfig | null> {
    let parse = options && options.parse;
    let conf = await loadConfig(
      this.options.inputFS,
      searchPath,
      filePaths,
      parse == null ? null : {parse}
    );
    if (conf == null) {
      return null;
    }

    for (let file of conf.files) {
      this.addIncludedFile(file.filePath);
    }

    return conf.config;
  }

  async getConfig(
    filePaths: Array<FilePath>,
    options: ?{parse?: boolean}
  ): Promise<ThirdPartyConfig | null> {
    return this.getConfigFrom(this.searchPath, filePaths, options);
  }

  async getPackage(): Promise<PackageJSON | null> {
    if (this.pkg) {
      return this.pkg;
    }

    this.pkg = await this.getConfig(['package.json']);
    return this.pkg;
  }

  async isSource() {
    let pkg = await this.getPackage();
    return (
      !!(
        pkg &&
        pkg.source != null &&
        (await this.options.inputFS.realpath(this.searchPath)) !==
          this.searchPath
      ) || !this.searchPath.includes(NODE_MODULES)
    );
  }
}
