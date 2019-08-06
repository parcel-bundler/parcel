// @flow strict-local
// flowlint unsafe-getters-setters:off
import type {
  Config as IConfig,
  FilePath,
  Glob,
  PackageJSON,
  PackageName,
  ThirdPartyConfig
} from '@parcel/types';
import type InternalConfig from '../Config';
import {loadConfig} from '@parcel/utils';

import path from 'path';

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

export default class Config implements IConfig {
  #config: InternalConfig;

  constructor(config: InternalConfig) {
    this.#config = config;
  }

  get env() {
    return this.#config.env;
  }

  get options() {
    return this.#config.options;
  }

  get searchPath() {
    return this.#config.searchPath;
  }

  get result() {
    return this.#config.result;
  }

  setResolvedPath(filePath: FilePath) {
    this.#config.resolvedPath = filePath;
  }

  // $FlowFixMe
  setResult(result: any) {
    this.#config.result = result;
  }

  setResultHash(resultHash: string) {
    this.#config.resultHash = resultHash;
  }

  addIncludedFile(filePath: FilePath) {
    this.#config.includedFiles.add(filePath);
  }

  addDevDependency(name: PackageName, version?: string) {
    this.#config.devDeps.set(name, version);
  }

  setWatchGlob(glob: Glob) {
    this.#config.watchGlob = glob;
  }

  shouldRehydrate() {
    this.#config.shouldRehydrate = true;
  }

  shouldReload() {
    this.#config.shouldReload = true;
  }

  shouldInvalidateOnStartup() {
    this.#config.shouldInvalidateOnStartup = true;
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
    if (this.#config.pkg) {
      return this.#config.pkg;
    }

    this.#config.pkg = await this.getConfig(['package.json']);
    return this.#config.pkg;
  }

  async isSource() {
    let pkg = await this.getPackage();
    return (
      !!(
        pkg &&
        pkg.source != null &&
        (await this.options.inputFS.realpath(this.searchPath)) !==
          this.searchPath
      ) || !this.#config.searchPath.includes(NODE_MODULES)
    );
  }
}
