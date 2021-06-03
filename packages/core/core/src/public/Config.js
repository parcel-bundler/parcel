// @flow strict-local
import type {
  Config as IConfig,
  ConfigResult,
  FileCreateInvalidation,
  FilePath,
  PackageJSON,
  ConfigResultWithFilePath,
  DevDepOptions,
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
  #pkg /*: ?PackageJSON */;
  #pkgFilePath /*: ?FilePath */;
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

  addDevDependency(devDep: DevDepOptions) {
    this.#config.devDeps.push(devDep);
  }

  invalidateOnFileCreate(invalidation: FileCreateInvalidation) {
    this.#config.invalidateOnFileCreate.push(invalidation);
  }

  shouldInvalidateOnStartup() {
    this.#config.shouldInvalidateOnStartup = true;
  }

  async getConfigFrom(
    searchPath: FilePath,
    fileNames: Array<string>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResultWithFilePath | null> {
    let packageKey = options?.packageKey;
    if (packageKey != null) {
      let pkg = await this.getConfigFrom(searchPath, ['package.json']);
      if (pkg && pkg.contents[packageKey]) {
        return {
          contents: pkg.contents[packageKey],
          filePath: pkg.filePath,
        };
      }
    }

    if (fileNames.length === 0) {
      return null;
    }

    // Invalidate when any of the file names are created above the search path.
    for (let fileName of fileNames) {
      this.invalidateOnFileCreate({
        fileName,
        aboveFilePath: searchPath,
      });
    }

    let parse = options && options.parse;
    let conf = await loadConfig(
      this.#options.inputFS,
      searchPath,
      fileNames,
      this.#options.projectRoot,
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
    if (this.#pkg) {
      return this.#pkg;
    }

    let pkgConfig = await this.getConfig(['package.json']);
    if (!pkgConfig) {
      return null;
    }

    this.#pkg = pkgConfig.contents;
    this.#pkgFilePath = pkgConfig.filePath;

    return this.#pkg;
  }
}
