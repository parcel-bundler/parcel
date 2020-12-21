// @flow strict-local
import type {
  Config as IConfig,
  ConfigResult,
  FilePath,
  Glob,
  PackageJSON,
  PackageName,
  ConfigResultWithFilePath,
} from '@parcel/types';
import type {Config, ParcelOptions} from '../types';

import {DefaultWeakMap, loadConfig} from '@parcel/utils';

import Environment from './Environment';

const internalConfigToConfig: DefaultWeakMap<
  ParcelOptions,
  WeakMap<Config, PublicConfig>,
> = new DefaultWeakMap(() => new WeakMap());

export default class PublicConfig implements IConfig {
  #config /*: Config */;
  #options /*: ParcelOptions */;

  constructor(config: Config, options: ParcelOptions): PublicConfig {
    let existing = internalConfigToConfig.get(options).get(config);
    if (existing != null) {
      return existing;
    }

    this.#config = config;
    this.#options = options;
    internalConfigToConfig.get(options).set(config, this);
    return this;
  }

  get env(): Environment {
    return new Environment(this.#config.env);
  }

  get searchPath(): FilePath {
    return this.#config.searchPath;
  }

  get result(): ConfigResult {
    return this.#config.result;
  }

  get isSource(): boolean {
    return this.#config.isSource;
  }

  get includedFiles(): Set<FilePath> {
    return this.#config.includedFiles;
  }

  // $FlowFixMe
  setResult(result: any): void {
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
      exclude?: boolean,
    |},
  ): Promise<ConfigResultWithFilePath | null> {
    let packageKey = options && options.packageKey;
    if (packageKey != null) {
      let pkg = await this.getPackage();
      if (pkg && pkg[packageKey]) {
        return {
          contents: pkg[packageKey],
          // This should be fine as pkgFilePath should be defined by getPackage()
          filePath: this.#config.pkgFilePath || '',
        };
      }
    }

    if (filePaths.length === 0) {
      return null;
    }

    let parse = options && options.parse;
    let conf = await loadConfig(
      this.#options.inputFS,
      searchPath,
      filePaths,
      parse == null ? null : {parse},
    );
    if (conf == null) {
      return null;
    }

    let configFilePath = conf.files[0].filePath;
    if (!options || !options.exclude) {
      this.addIncludedFile(configFilePath);
    }

    return {
      contents: conf.config,
      filePath: configFilePath,
    };
  }

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResultWithFilePath | null> {
    return this.getConfigFrom(this.searchPath, filePaths, options);
  }

  async getPackage(): Promise<PackageJSON | null> {
    if (this.#config.pkg) {
      return this.#config.pkg;
    }

    let pkgConfig = await this.getConfig(['package.json']);
    if (!pkgConfig) {
      return null;
    }

    this.#config.pkg = pkgConfig.contents;
    this.#config.pkgFilePath = pkgConfig.filePath;

    return this.#config.pkg;
  }
}
