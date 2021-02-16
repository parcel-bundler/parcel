// @flow strict-local
import type {
  Config as IConfig,
  ConfigResult,
  FileCreateInvalidation,
  FilePath,
  PackageJSON,
  PackageName,
  ConfigResultWithFilePath,
  ConfigDevDepOptions,
  Transformer,
} from '@parcel/types';
import type {Config, DevDepRequest, ParcelOptions} from '../types';
import type {LoadedPlugin} from '../ParcelConfig';

import {DefaultWeakMap, loadConfig} from '@parcel/utils';
import Environment from './Environment';
import {getInvalidationHash} from '../assetUtils';

const internalConfigToConfig: DefaultWeakMap<
  ParcelOptions,
  WeakMap<Config, PublicConfig>,
> = new DefaultWeakMap(() => new WeakMap());

export default class PublicConfig implements IConfig {
  #config /*: Config */;
  #plugin /*: LoadedPlugin<Transformer> */;
  #pkg /*: ?PackageJSON */;
  #pkgFilePath /*: ?FilePath */;
  #options /*: ParcelOptions */;

  constructor(
    config: Config,
    plugin: LoadedPlugin<Transformer>,
    options: ParcelOptions,
  ): PublicConfig {
    let existing = internalConfigToConfig.get(options).get(config);
    if (existing != null) {
      return existing;
    }

    this.#config = config;
    this.#plugin = plugin;
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

  async addDevDependency(
    name: PackageName,
    resolveFrom: FilePath,
    options?: ConfigDevDepOptions,
  ): Promise<void> {
    // Ensure that the package manager has an entry for this resolution.
    await this.#options.packageManager.resolve(name, resolveFrom);
    let invalidations = this.#options.packageManager.getInvalidations(
      name,
      resolveFrom,
    );

    let hash = await getInvalidationHash(
      [...invalidations.invalidateOnFileChange].map(f => ({
        type: 'file',
        filePath: f,
      })),
      this.#options,
    );

    let devDep: DevDepRequest = {
      name,
      resolveFrom,
      hash,
      invalidateOnFileCreate: invalidations.invalidateOnFileCreate,
      invalidateOnFileChange: invalidations.invalidateOnFileChange,
    };

    // Optionally also invalidate the parcel plugin that is loading the config
    // when this dev dep changes (e.g. to invalidate local caches).
    if (options?.invalidateParcelPlugin) {
      devDep.additionalInvalidations = [
        {
          name: this.#plugin.name,
          resolveFrom: this.#plugin.resolveFrom,
        },
      ];
    }

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
          filePath: this.#pkgFilePath || '',
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
