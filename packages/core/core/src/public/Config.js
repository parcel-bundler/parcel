// @flow strict-local
// flowlint unsafe-getters-setters:off
import type {
  Config as IConfig,
  FilePath,
  Glob,
  PackageJSON,
  PackageName,
  ConfigResult
} from '@parcel/types';
import type {Config, ParcelOptions} from '../types';

import {loadConfig} from '@parcel/utils';

import Environment from './Environment';

export default class PublicConfig implements IConfig {
  #config; // Config;
  #options; // ParcelOptions

  constructor(config: Config, options: ParcelOptions) {
    this.#config = config;
    this.#options = options;
  }

  get env() {
    return new Environment(this.#config.env);
  }

  get searchPath() {
    return this.#config.searchPath;
  }

  get result() {
    return this.#config.result;
  }

  get isSource() {
    return this.#config.isSource;
  }

  get resolvedPath() {
    return this.#config.resolvedPath;
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
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean
    |}
  ): Promise<ConfigResult | null> {
    let parse = options && options.parse;
    let conf = await loadConfig(
      this.#options.inputFS,
      searchPath,
      filePaths,
      parse == null ? null : {parse}
    );
    if (conf == null) {
      return null;
    }

    if (!options || !options.exclude) {
      if (this.#config.resolvedPath == null) {
        this.setResolvedPath(conf.files[0].filePath);
      } else {
        this.addIncludedFile(conf.files[0].filePath);
      }
    }

    return conf.config;
  }

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean
    |}
  ): Promise<ConfigResult | null> {
    return this.getConfigFrom(this.searchPath, filePaths, options);
  }

  async getPackage(): Promise<PackageJSON | null> {
    if (this.#config.pkg) {
      return this.#config.pkg;
    }

    this.#config.pkg = await this.getConfig(['package.json']);
    return this.#config.pkg;
  }
}
